// JSON export/import (full fidelity) and per-category CSV export. Pure functions over a DB handle so
// they are unit-testable; the routes in src/routes/api/export.*, api/import only add HTTP concerns.
import { uuidv7 } from 'uuidv7';
import { getDb, schema, type DB } from './db';
import { applyMutations, foreignCatalogSources, snapshot, wipeUserData } from './repo';
import type { Category, CatalogEntry, ExportFile, Item, LogEntry, Mutation } from '../shared/types';
import { csvField, csvRow } from '../shared/csv';

export { csvField, csvRow };

export const EXPORT_FORMAT = 'forgetless-export';
export const EXPORT_VERSION = 1;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export type ImportMode = 'merge' | 'replace';

export class ImportError extends Error {
	constructor(
		message: string,
		public status = 400
	) {
		super(message);
	}
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Current (non-deleted) data for a user plus the catalog entries its items reference. */
export function buildExport(userId: string, db: DB = getDb(), now = Date.now()): ExportFile {
	const snap = snapshot(userId, db);
	const categories = snap.categories.filter((c) => !c.deletedAt).sort(byId);
	const catIds = new Set(categories.map((c) => c.id));
	const items = snap.items.filter((i) => !i.deletedAt && catIds.has(i.categoryId)).sort(byId);
	const itemIds = new Set(items.map((i) => i.id));
	const logEntries = snap.logEntries
		.filter((l) => !l.deletedAt && itemIds.has(l.itemId))
		.sort(byId);
	const catalogIds = new Set(items.map((i) => i.catalogEntryId).filter(Boolean));
	const catalogEntries = snap.catalogEntries.filter((c) => catalogIds.has(c.id)).sort(byId);
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: now,
		categories,
		items,
		logEntries,
		catalogEntries
	};
}

const isObj = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** Structural validation of an uploaded export. Row-level validation happens in applyMutations. */
export function parseExportFile(input: unknown): ExportFile {
	if (!isObj(input)) throw new ImportError('Expected a JSON object');
	if (input.format !== EXPORT_FORMAT) throw new ImportError(`Not a ${EXPORT_FORMAT} file`);
	if (input.version !== EXPORT_VERSION)
		throw new ImportError(`Unsupported export version: ${String(input.version)}`);
	for (const k of ['categories', 'items', 'logEntries'] as const) {
		if (!Array.isArray(input[k])) throw new ImportError(`"${k}" must be an array`);
		if (!(input[k] as unknown[]).every(isObj)) throw new ImportError(`"${k}" must contain objects`);
	}
	if (input.catalogEntries != null && !Array.isArray(input.catalogEntries))
		throw new ImportError('"catalogEntries" must be an array');
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: typeof input.exportedAt === 'number' ? input.exportedAt : 0,
		categories: input.categories as Category[],
		items: input.items as Item[],
		logEntries: input.logEntries as LogEntry[],
		catalogEntries: ((input.catalogEntries as unknown[]) ?? []).filter(
			isObj
		) as unknown as CatalogEntry[]
	};
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(v);

/**
 * Inserts catalog entries that this instance doesn't have yet and returns a map from the file's ids to
 * local ids. Existing (shared) entries are never overwritten by user uploads; newly inserted ones get
 * fetchedAt=0 so the provider refreshes them the next time anyone selects that title.
 */
function importCatalog(db: DB, entries: CatalogEntry[], userId: string): Map<string, string> {
	const idMap = new Map<string, string>();
	// Entries of another user's (private) catalog are never linked or copied.
	const foreign = foreignCatalogSources(
		db,
		userId,
		entries.map((e) => (typeof e.source === 'string' ? e.source : ''))
	);
	for (const e of entries) {
		if (!isId(e.id) || typeof e.source !== 'string' || typeof e.externalId !== 'string') continue;
		if (foreign.has(e.source)) continue;
		if (typeof e.title !== 'string' || !e.title.trim() || typeof e.kind !== 'string') continue;
		const existing = db.sqlite
			.prepare('SELECT id FROM catalog_entries WHERE source = ? AND external_id = ?')
			.get(e.source, e.externalId) as { id: string } | undefined;
		if (existing) {
			idMap.set(e.id, existing.id);
			continue;
		}
		const taken = db.sqlite.prepare('SELECT 1 FROM catalog_entries WHERE id = ?').get(e.id);
		const id = taken
			? `${e.source}-${e.externalId}-${uuidv7().slice(-12)}`
					.replace(/[^0-9a-zA-Z-]/g, '-')
					.slice(-64)
			: e.id;
		db.insert(schema.catalogEntries)
			.values({
				id,
				source: e.source.slice(0, 60),
				externalId: e.externalId.slice(0, 120),
				kind: e.kind.slice(0, 40),
				title: e.title.slice(0, 300),
				subtitle: typeof e.subtitle === 'string' ? e.subtitle.slice(0, 300) : null,
				year: typeof e.year === 'number' ? Math.trunc(e.year) : null,
				imageUrl:
					typeof e.imageUrl === 'string' && /^https:\/\//.test(e.imageUrl)
						? e.imageUrl.slice(0, 1000)
						: null,
				data: isObj(e.data) ? e.data : {},
				fetchedAt: 0
			})
			.run();
		idMap.set(e.id, id);
	}
	return idMap;
}

/** Ids in `table` that already belong to a different user (e.g. importing someone else's export). */
function foreignIds(
	db: DB,
	table: 'categories' | 'items' | 'log_entries',
	userId: string,
	ids: string[]
): Set<string> {
	const out = new Set<string>();
	const stmt = db.sqlite.prepare(`SELECT id FROM ${table} WHERE id = ? AND user_id != ?`);
	for (const id of ids) if (stmt.get(id, userId)) out.add(id);
	return out;
}

function remapper(foreign: Set<string>) {
	const m = new Map<string, string>();
	return (id: string) => {
		if (!foreign.has(id)) return id;
		let n = m.get(id);
		if (!n) m.set(id, (n = uuidv7()));
		return n;
	};
}

export interface ImportOptions {
	/** Max non-deleted items the user may have after the import (guest accounts). */
	itemCap?: number;
}

/**
 * Imports an export file for `userId`. `replace` wipes the user's data first; `merge` upserts with
 * last-write-wins on updatedAt, so newer local rows are kept. Everything runs in one transaction.
 */
export function importExport(
	userId: string,
	input: unknown,
	mode: ImportMode,
	db: DB = getDb(),
	opts: ImportOptions = {}
): { applied: number; skipped: number } {
	const file = parseExportFile(input);
	const tx = db.sqlite.transaction(() => {
		if (mode === 'replace') wipeUserData(userId, db);
		const catalogMap = importCatalog(db, file.catalogEntries, userId);

		const mapCat = remapper(
			foreignIds(db, 'categories', userId, file.categories.map((c) => c.id).filter(isId))
		);
		const mapItem = remapper(
			foreignIds(db, 'items', userId, file.items.map((i) => i.id).filter(isId))
		);
		const mapLog = remapper(
			foreignIds(db, 'log_entries', userId, file.logEntries.map((l) => l.id).filter(isId))
		);

		const mutations: Mutation[] = [
			...file.categories.map((c): Mutation => ({
				kind: 'category',
				row: { ...c, id: isId(c.id) ? mapCat(c.id) : c.id }
			})),
			...file.items.map((i): Mutation => ({
				kind: 'item',
				row: {
					...i,
					id: isId(i.id) ? mapItem(i.id) : i.id,
					categoryId: isId(i.categoryId) ? mapCat(i.categoryId) : i.categoryId,
					catalogEntryId: i.catalogEntryId ? (catalogMap.get(i.catalogEntryId) ?? null) : null
				}
			})),
			...file.logEntries.map((l): Mutation => ({
				kind: 'logEntry',
				row: {
					...l,
					id: isId(l.id) ? mapLog(l.id) : l.id,
					itemId: isId(l.itemId) ? mapItem(l.itemId) : l.itemId
				}
			}))
		];
		const res = applyMutations(userId, mutations, db);

		if (opts.itemCap != null) {
			const { n } = db.sqlite
				.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND deleted_at IS NULL')
				.get(userId) as { n: number };
			if (n > opts.itemCap)
				throw new ImportError(`This account is limited to ${opts.itemCap} items`, 403);
		}
		return res;
	});
	return tx();
}

// ---------- CSV ----------

/** One CSV for one category: fixed columns plus one column per custom field (header = field label). */
export function toCsv(category: Category, items: Item[], logEntries: LogEntry[]): string {
	const fields = category.fieldSchema ?? [];
	const header = [
		'title',
		'status',
		'recommended_by',
		'source',
		'why',
		'tags',
		'created_at',
		'last_logged',
		'latest_rating',
		...fields.map((f) => f.label || f.key)
	];
	const logsByItem = new Map<string, LogEntry[]>();
	for (const l of logEntries) {
		if (l.deletedAt) continue;
		const arr = logsByItem.get(l.itemId) ?? [];
		arr.push(l);
		logsByItem.set(l.itemId, arr);
	}
	const rows = items
		.filter((i) => !i.deletedAt && i.categoryId === category.id)
		.sort((a, b) => a.createdAt - b.createdAt || byId(a, b))
		.map((i) => {
			// newest first: by date, then by creation time
			const logs = (logsByItem.get(i.id) ?? []).sort((a, b) =>
				a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt
			);
			const rated = logs.find((l) => l.rating != null);
			return csvRow([
				i.title,
				i.status,
				i.recommendedBy,
				i.source,
				i.why,
				i.tags.join(';'),
				new Date(i.createdAt).toISOString(),
				logs[0]?.date ?? '',
				rated ? String(rated.rating! / 2) : '',
				...fields.map((f) => i.customFields?.[f.key] ?? '')
			]);
		});
	return [csvRow(header), ...rows].join('\r\n') + '\r\n';
}

/** Safe-ish filename fragment. */
export function slug(s: string): string {
	return (
		s
			.normalize('NFKD')
			.replace(/[^\w\s-]/g, '')
			.trim()
			.replace(/\s+/g, '-')
			.toLowerCase()
			.slice(0, 40) || 'export'
	);
}
