// Server-side data access for app entities. All mutations go through `applyMutations`
// (used by sync push, import and seeding) so LWW, tags and FTS stay consistent.
import { and, eq, gt, inArray } from 'drizzle-orm';
import { getDb, schema, type DB } from './db';
import { monotonicNow } from './clock';
import type {
	Category,
	CatalogEntry,
	Item,
	LogEntry,
	Mutation,
	Status,
	SyncPullResponse
} from '../shared/types';
import { STATUSES } from '../shared/types';

type CatRow = typeof schema.categories.$inferSelect;
type ItemRow = typeof schema.items.$inferSelect;
type LogRow = typeof schema.logEntries.$inferSelect;
type CatalogRow = typeof schema.catalogEntries.$inferSelect;

export const toCategory = (r: CatRow): Category => ({
	id: r.id,
	name: r.name,
	icon: r.icon,
	sort: r.sort,
	provider: r.provider,
	fieldSchema: r.fieldSchema ?? [],
	createdAt: r.createdAt,
	updatedAt: r.updatedAt,
	deletedAt: r.deletedAt
});

export const toLogEntry = (r: LogRow): LogEntry => ({
	id: r.id,
	itemId: r.itemId,
	date: r.date,
	rating: r.rating,
	note: r.note,
	createdAt: r.createdAt,
	updatedAt: r.updatedAt,
	deletedAt: r.deletedAt
});

export const toCatalogEntry = (r: CatalogRow): CatalogEntry => ({
	id: r.id,
	source: r.source,
	externalId: r.externalId,
	kind: r.kind,
	title: r.title,
	subtitle: r.subtitle,
	year: r.year,
	imageUrl: r.imageUrl,
	data: r.data ?? {},
	fetchedAt: r.fetchedAt
});

function tagsFor(db: DB, itemIds: string[]): Map<string, string[]> {
	const m = new Map<string, string[]>();
	if (!itemIds.length) return m;
	for (let i = 0; i < itemIds.length; i += 500) {
		const rows = db
			.select()
			.from(schema.itemTags)
			.where(inArray(schema.itemTags.itemId, itemIds.slice(i, i + 500)))
			.all();
		for (const r of rows) {
			const arr = m.get(r.itemId) ?? [];
			arr.push(r.tag);
			m.set(r.itemId, arr);
		}
	}
	for (const arr of m.values()) arr.sort();
	return m;
}

function toItems(db: DB, rows: ItemRow[]): Item[] {
	const tags = tagsFor(
		db,
		rows.map((r) => r.id)
	);
	return rows.map((r) => ({
		id: r.id,
		categoryId: r.categoryId,
		catalogEntryId: r.catalogEntryId,
		title: r.title,
		status: r.status as Status,
		recommendedBy: r.recommendedBy,
		source: r.source,
		why: r.why,
		tags: tags.get(r.id) ?? [],
		customFields: r.customFields ?? {},
		needsMatch: r.needsMatch,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		deletedAt: r.deletedAt
	}));
}

/** Everything that changed for `userId` after `since` (server cursor). since=0 → full snapshot. */
export function pull(userId: string, since = 0, db = getDb()): SyncPullResponse {
	const cursor = monotonicNow();
	const cats = db
		.select()
		.from(schema.categories)
		.where(and(eq(schema.categories.userId, userId), gt(schema.categories.serverUpdatedAt, since)))
		.all();
	const itemRows = db
		.select()
		.from(schema.items)
		.where(and(eq(schema.items.userId, userId), gt(schema.items.serverUpdatedAt, since)))
		.all();
	const logs = db
		.select()
		.from(schema.logEntries)
		.where(and(eq(schema.logEntries.userId, userId), gt(schema.logEntries.serverUpdatedAt, since)))
		.all();
	const catalogIds = [
		...new Set(itemRows.map((r) => r.catalogEntryId).filter((x): x is string => !!x))
	];
	const catalog = catalogIds.length
		? db
				.select()
				.from(schema.catalogEntries)
				.where(inArray(schema.catalogEntries.id, catalogIds))
				.all()
		: [];
	return {
		cursor,
		categories: cats.map(toCategory),
		items: toItems(db, itemRows),
		logEntries: logs.map(toLogEntry),
		catalogEntries: catalog.map(toCatalogEntry)
	};
}

/** Full current state (including tombstones) for export. */
export function snapshot(userId: string, db = getDb()) {
	return pull(userId, 0, db);
}

// ---------- validation ----------
const str = (v: unknown, max = 2000): string | null =>
	typeof v === 'string' && v.trim() !== '' ? v.slice(0, max) : null;
const num = (v: unknown, d: number) =>
	typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : d;
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(v);

export class MutationError extends Error {}

function normTags(tags: unknown): string[] {
	if (!Array.isArray(tags)) return [];
	return [
		...new Set(
			tags
				.filter((t) => typeof t === 'string')
				.map((t) => t.trim().toLowerCase())
				.filter(Boolean)
		)
	]
		.slice(0, 50)
		.map((t) => t.slice(0, 60));
}

function updateFts(db: DB, userId: string, item: Item) {
	db.sqlite.prepare('DELETE FROM items_fts WHERE item_id = ?').run(item.id);
	if (item.deletedAt) return;
	db.sqlite
		.prepare(
			'INSERT INTO items_fts (item_id, user_id, title, recommended_by, source, why, tags) VALUES (?,?,?,?,?,?,?)'
		)
		.run(
			item.id,
			userId,
			item.title,
			item.recommendedBy ?? '',
			item.source ?? '',
			item.why ?? '',
			item.tags.join(' ')
		);
}

/**
 * Upsert rows by id with last-write-wins on `updatedAt`. Rows owned by another user are rejected.
 * Returns counts. Runs in a single transaction.
 */
export function applyMutations(userId: string, mutations: Mutation[], db = getDb()) {
	let applied = 0;
	let skipped = 0;
	const tx = db.sqlite.transaction(() => {
		for (const m of mutations) {
			const r = m.row as { id?: unknown; updatedAt?: unknown };
			if (!isId(r?.id)) throw new MutationError('invalid id');
			const updatedAt = num(r.updatedAt, Date.now());
			const serverUpdatedAt = monotonicNow();

			if (m.kind === 'category') {
				const c = m.row;
				const existing = db
					.select()
					.from(schema.categories)
					.where(eq(schema.categories.id, c.id))
					.get();
				if (existing && existing.userId !== userId) throw new MutationError('forbidden');
				if (existing && existing.updatedAt > updatedAt) {
					skipped++;
					continue;
				}
				const name = str(c.name, 100);
				if (!name) throw new MutationError('category name required');
				const values = {
					id: c.id,
					userId,
					name,
					icon: str(c.icon, 16) ?? '📌',
					sort: num(c.sort, 0),
					provider: str(c.provider, 40),
					fieldSchema: Array.isArray(c.fieldSchema) ? c.fieldSchema.slice(0, 30) : [],
					createdAt: num(c.createdAt, updatedAt),
					updatedAt,
					deletedAt: typeof c.deletedAt === 'number' ? c.deletedAt : null,
					serverUpdatedAt
				};
				db.insert(schema.categories)
					.values(values)
					.onConflictDoUpdate({ target: schema.categories.id, set: values })
					.run();
				applied++;
			} else if (m.kind === 'item') {
				const it = m.row;
				const existing = db.select().from(schema.items).where(eq(schema.items.id, it.id)).get();
				if (existing && existing.userId !== userId) throw new MutationError('forbidden');
				if (existing && existing.updatedAt > updatedAt) {
					skipped++;
					continue;
				}
				const title = str(it.title, 300);
				if (!title) throw new MutationError('item title required');
				if (!isId(it.categoryId)) throw new MutationError('item categoryId required');
				const status: Status = STATUSES.includes(it.status) ? it.status : 'want';
				const values = {
					id: it.id,
					userId,
					categoryId: it.categoryId,
					catalogEntryId: isId(it.catalogEntryId) ? it.catalogEntryId : null,
					title,
					status,
					recommendedBy: str(it.recommendedBy, 200),
					source: str(it.source, 1000),
					why: str(it.why, 5000),
					customFields:
						it.customFields &&
						typeof it.customFields === 'object' &&
						!Array.isArray(it.customFields)
							? it.customFields
							: {},
					needsMatch: !!it.needsMatch,
					createdAt: num(it.createdAt, updatedAt),
					updatedAt,
					deletedAt: typeof it.deletedAt === 'number' ? it.deletedAt : null,
					serverUpdatedAt
				};
				db.insert(schema.items)
					.values(values)
					.onConflictDoUpdate({ target: schema.items.id, set: values })
					.run();
				const tags = normTags(it.tags);
				db.delete(schema.itemTags).where(eq(schema.itemTags.itemId, it.id)).run();
				for (const tag of tags) db.insert(schema.itemTags).values({ itemId: it.id, tag }).run();
				updateFts(db, userId, { ...it, ...values, tags, status });
				applied++;
			} else if (m.kind === 'logEntry') {
				const l = m.row;
				const existing = db
					.select()
					.from(schema.logEntries)
					.where(eq(schema.logEntries.id, l.id))
					.get();
				if (existing && existing.userId !== userId) throw new MutationError('forbidden');
				if (existing && existing.updatedAt > updatedAt) {
					skipped++;
					continue;
				}
				if (!isId(l.itemId)) throw new MutationError('log itemId required');
				const date =
					typeof l.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.date)
						? l.date
						: new Date().toISOString().slice(0, 10);
				const rating =
					typeof l.rating === 'number' ? Math.min(10, Math.max(1, Math.round(l.rating))) : null;
				const values = {
					id: l.id,
					userId,
					itemId: l.itemId,
					date,
					rating,
					note: str(l.note, 5000),
					createdAt: num(l.createdAt, updatedAt),
					updatedAt,
					deletedAt: typeof l.deletedAt === 'number' ? l.deletedAt : null,
					serverUpdatedAt
				};
				db.insert(schema.logEntries)
					.values(values)
					.onConflictDoUpdate({ target: schema.logEntries.id, set: values })
					.run();
				applied++;
			} else {
				throw new MutationError('unknown mutation kind');
			}
		}
	});
	tx();
	return { applied, skipped };
}

/** Upsert catalog entries (shared cache across users). Returns the stored rows. */
export function upsertCatalogEntries(
	entries: Omit<CatalogEntry, 'id'>[],
	db = getDb()
): CatalogEntry[] {
	const out: CatalogEntry[] = [];
	for (const e of entries) {
		const existing = db
			.select()
			.from(schema.catalogEntries)
			.where(
				and(
					eq(schema.catalogEntries.source, e.source),
					eq(schema.catalogEntries.externalId, e.externalId)
				)
			)
			.get();
		const id =
			existing?.id ?? `${e.source}-${e.externalId}`.replace(/[^0-9a-zA-Z-]/g, '-').slice(0, 64);
		const values = { ...e, id };
		db.insert(schema.catalogEntries)
			.values(values)
			.onConflictDoUpdate({ target: schema.catalogEntries.id, set: values })
			.run();
		out.push(values as CatalogEntry);
	}
	return out;
}

/** FTS search over the user's own items. Returns item ids, best first. */
export function searchItems(userId: string, q: string, limit = 50, db = getDb()): string[] {
	const terms = q
		.replace(/["*^():]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.map((t) => `"${t}"*`)
		.join(' ');
	if (!terms) return [];
	const rows = db.sqlite
		.prepare(
			'SELECT item_id FROM items_fts WHERE items_fts MATCH ? AND user_id = ? ORDER BY rank LIMIT ?'
		)
		.all(terms, userId, limit) as { item_id: string }[];
	return rows.map((r) => r.item_id);
}

/** Hard-delete all of a user's app data (used by import "replace" and tests). Keeps the account. */
export function wipeUserData(userId: string, db = getDb()) {
	const tx = db.sqlite.transaction(() => {
		db.sqlite.prepare('DELETE FROM items_fts WHERE user_id = ?').run(userId);
		db.sqlite
			.prepare('DELETE FROM item_tags WHERE item_id IN (SELECT id FROM items WHERE user_id = ?)')
			.run(userId);
		db.sqlite.prepare('DELETE FROM log_entries WHERE user_id = ?').run(userId);
		db.sqlite.prepare('DELETE FROM items WHERE user_id = ?').run(userId);
		db.sqlite.prepare('DELETE FROM categories WHERE user_id = ?').run(userId);
	});
	tx();
}
