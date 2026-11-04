// User catalogs (PRD §5): an uploaded CSV/JSON list that acts as an autocomplete source for a category.
// Rows are stored in catalog_entries with source 'catalog:<catalogId>'. Unlike provider entries (a shared
// cache), they're private: every read joins through catalogs.user_id. They aren't in the shared provider
// registry for that reason; search goes through searchCatalogs / GET /api/catalogs/search instead.
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb, schema, type DB } from './db';
import { applyMutations, toCatalogEntry, toCategory } from './repo';
import { csvRecords, sniffDelimiter } from '../shared/csv';
import type { Catalog, CatalogEntry, CatalogMapping, Category, FieldDef } from '../shared/types';

export const CATALOG_MAX_BYTES = 20 * 1024 * 1024;
export const CATALOG_MAX_ROWS = 50_000;
export const CATALOG_GUEST_MAX_ROWS = 2_000;
export const CATALOGS_PER_USER = 50;
export const CATALOG_KIND = 'catalog';

export class CatalogError extends Error {
	constructor(
		message: string,
		public status = 400
	) {
		super(message);
	}
}

export const catalogSource = (catalogId: string) => `catalog:${catalogId}`;

export interface CatalogTable {
	headers: string[];
	rows: Record<string, string>[];
}

const cell = (v: unknown): string =>
	v == null
		? ''
		: typeof v === 'string'
			? v
			: typeof v === 'number' || typeof v === 'boolean'
				? String(v)
				: JSON.stringify(v);

/** Parses an uploaded CSV (',', ';' or tab) or JSON (an array of objects, or an object holding one). */
export function parseCatalogUpload(name: string, text: string): CatalogTable {
	const t = text.replace(/^\uFEFF/, '');
	const looksJson = /\.json$/i.test(name) || /^\s*[[{]/.test(t);
	if (looksJson) {
		let data: unknown;
		try {
			data = JSON.parse(t);
		} catch {
			throw new CatalogError('Invalid JSON');
		}
		if (data && typeof data === 'object' && !Array.isArray(data)) {
			const arr = Object.values(data).find(Array.isArray);
			if (!arr) throw new CatalogError('Expected a JSON array of objects');
			data = arr;
		}
		if (!Array.isArray(data)) throw new CatalogError('Expected a JSON array of objects');
		const objs = data.filter(
			(o): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o)
		);
		const headers: string[] = [];
		const seen = new Set<string>();
		for (const o of objs.slice(0, 1000))
			for (const k of Object.keys(o))
				if (!seen.has(k)) {
					seen.add(k);
					headers.push(k);
				}
		const rows = objs.map((o) => Object.fromEntries(headers.map((h) => [h, cell(o[h]).trim()])));
		return { headers, rows };
	}
	const { headers, rows } = csvRecords(t, sniffDelimiter(t));
	return { headers: headers.filter(Boolean), rows };
}

const findHeader = (headers: string[], patterns: RegExp[], taken: Set<string>) => {
	for (const re of patterns) {
		const h = headers.find((x) => !taken.has(x) && re.test(x.trim()));
		if (h) return h;
	}
	return null;
};

export function fieldKey(label: string): string {
	return (
		label
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 40) || 'field'
	);
}

/** Guesses title/subtitle/year/image/id columns from header names; the rest become extra fields. */
export function suggestMapping(headers: string[]): CatalogMapping {
	const taken = new Set<string>();
	const pick = (patterns: RegExp[]) => {
		const h = findHeader(headers, patterns, taken);
		if (h) taken.add(h);
		return h;
	};
	const title =
		pick([/^(title|name)$/i, /^(item|game|book|film|movie|product|dish|place)$/i, /title|name/i]) ??
		headers[0] ??
		'';
	if (title) taken.add(title);
	const id = pick([/^(id|sku|isbn13|isbn|code|uuid|key)$/i, /(^|[ _])id$/i]);
	const image = pick([
		/^(image|img|cover|poster|thumbnail|thumb|photo|picture)( ?url)?$/i,
		/image|cover|poster/i
	]);
	const year = pick([/^(year|released|release year|year published|published)$/i, /year/i]);
	const subtitle = pick([
		/^(subtitle|author|artist|brand|creator|director|designer|publisher|by|maker|producer|winery|brewery)$/i,
		/author|artist|brand|creator|designer|publisher/i
	]);
	const fields = headers
		.filter((h) => h && !taken.has(h))
		.map((h) => ({ column: h, key: fieldKey(h), label: h.trim() }));
	return { title, subtitle, year, image, id, fields };
}

function parseYear(v: string | undefined): number | null {
	const m = /\b(\d{4})\b/.exec(v ?? '');
	return m ? Number(m[1]) : null;
}

export interface CreateCatalogInput {
	categoryId: string;
	name: string;
	mapping: CatalogMapping;
	table: CatalogTable;
	/** add mapped extra fields missing from the category's field schema */
	addFields?: boolean;
	maxRows?: number;
}

const toCatalog = (r: typeof schema.catalogs.$inferSelect): Catalog => ({
	id: r.id,
	categoryId: r.categoryId,
	name: r.name,
	columnMap: r.columnMap,
	rowCount: r.rowCount,
	createdAt: r.createdAt,
	updatedAt: r.updatedAt
});

function ownedCategory(userId: string, categoryId: string, db: DB): Category {
	const row = db
		.select()
		.from(schema.categories)
		.where(and(eq(schema.categories.id, categoryId), eq(schema.categories.userId, userId)))
		.get();
	if (!row || row.deletedAt) throw new CatalogError('Category not found', 404);
	return toCategory(row);
}

/** Validates the mapping, stores the catalog and its rows, and optionally extends the field schema. */
export function createCatalog(
	userId: string,
	input: CreateCatalogInput,
	db: DB = getDb(),
	now = Date.now()
): { catalog: Catalog; category: Category } {
	let category = ownedCategory(userId, input.categoryId, db);
	const { headers, rows } = input.table;
	const has = (h: string | null | undefined) => !!h && headers.includes(h);
	const m = input.mapping;
	if (!has(m.title)) throw new CatalogError('Choose which column holds the title');
	for (const k of ['subtitle', 'year', 'image', 'id'] as const)
		if (m[k] && !has(m[k])) throw new CatalogError(`Unknown column for ${k}: ${m[k]}`);
	const fields = (Array.isArray(m.fields) ? m.fields : [])
		.filter((f) => f && has(f.column) && typeof f.label === 'string')
		.slice(0, 30)
		.map((f) => ({
			column: f.column,
			label: f.label.trim().slice(0, 60) || f.column,
			key: fieldKey(typeof f.key === 'string' && f.key ? f.key : f.label || f.column)
		}));
	const mapping: CatalogMapping = {
		title: m.title,
		subtitle: has(m.subtitle) ? m.subtitle : null,
		year: has(m.year) ? m.year : null,
		image: has(m.image) ? m.image : null,
		id: has(m.id) ? m.id : null,
		fields
	};
	const name = (input.name ?? '').trim().slice(0, 100);
	if (!name) throw new CatalogError('Give the catalog a name');
	const usable = rows.filter((r) => (r[mapping.title] ?? '').trim());
	if (!usable.length) throw new CatalogError('No rows with a title');
	const max = input.maxRows ?? CATALOG_MAX_ROWS;
	if (usable.length > max) throw new CatalogError(`Catalogs are limited to ${max} rows`, 413);
	const { n } = db.sqlite
		.prepare('SELECT COUNT(*) AS n FROM catalogs WHERE user_id = ?')
		.get(userId) as { n: number };
	if (n >= CATALOGS_PER_USER)
		throw new CatalogError(`Limit of ${CATALOGS_PER_USER} catalogs reached`, 403);

	const id = uuidv7();
	const source = catalogSource(id);
	const insert = db.sqlite.prepare(
		'INSERT INTO catalog_entries (id, source, external_id, kind, title, subtitle, year, image_url, data, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
	);
	const tx = db.sqlite.transaction(() => {
		db.insert(schema.catalogs)
			.values({
				id,
				userId,
				categoryId: category.id,
				name,
				columnMap: mapping,
				rowCount: usable.length,
				createdAt: now,
				updatedAt: now
			})
			.run();
		const seenExt = new Set<string>();
		usable.forEach((r, i) => {
			let ext = (mapping.id ? (r[mapping.id] ?? '').trim() : '').slice(0, 120) || String(i + 1);
			if (seenExt.has(ext)) ext = `${ext}#${i + 1}`;
			seenExt.add(ext);
			const img = mapping.image ? (r[mapping.image] ?? '').trim() : '';
			const data: Record<string, string> = {};
			for (const f of fields) {
				const v = (r[f.column] ?? '').trim();
				if (v) data[f.key] = v.slice(0, 2000);
			}
			insert.run(
				uuidv7(),
				source,
				ext,
				CATALOG_KIND,
				r[mapping.title].trim().slice(0, 300),
				mapping.subtitle ? (r[mapping.subtitle] ?? '').trim().slice(0, 300) || null : null,
				mapping.year ? parseYear(r[mapping.year]) : null,
				/^https:\/\//.test(img) ? img.slice(0, 1000) : null,
				JSON.stringify({ catalog: name, fields: data }),
				now
			);
		});
		if (input.addFields) {
			const missing: FieldDef[] = fields
				.filter((f) => !category.fieldSchema.some((x) => x.key === f.key))
				.map((f) => ({ key: f.key, label: f.label, type: 'text' }));
			if (missing.length) {
				category = {
					...category,
					fieldSchema: [...category.fieldSchema, ...missing].slice(0, 30),
					updatedAt: Math.max(now, category.updatedAt + 1)
				};
				applyMutations(userId, [{ kind: 'category', row: category }], db);
			}
		}
	});
	tx();
	const row = db.select().from(schema.catalogs).where(eq(schema.catalogs.id, id)).get()!;
	return { catalog: toCatalog(row), category };
}

export function listCatalogs(
	userId: string,
	categoryId?: string | null,
	db: DB = getDb()
): Catalog[] {
	const where = categoryId
		? and(eq(schema.catalogs.userId, userId), eq(schema.catalogs.categoryId, categoryId))
		: eq(schema.catalogs.userId, userId);
	return db
		.select()
		.from(schema.catalogs)
		.where(where)
		.all()
		.map(toCatalog)
		.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Deletes a catalog and its rows. Rows that items still point at are kept (they carry the item's
 * metadata) but can no longer be searched, since search joins through the catalogs table.
 */
export function deleteCatalog(userId: string, id: string, db: DB = getDb()): boolean {
	const row = db
		.select()
		.from(schema.catalogs)
		.where(and(eq(schema.catalogs.id, id), eq(schema.catalogs.userId, userId)))
		.get();
	if (!row) return false;
	const tx = db.sqlite.transaction(() => {
		db.sqlite
			.prepare(
				'DELETE FROM catalog_entries WHERE source = ? AND id NOT IN (SELECT catalog_entry_id FROM items WHERE catalog_entry_id IS NOT NULL AND user_id = ?)'
			)
			.run(catalogSource(id), userId);
		db.delete(schema.catalogs).where(eq(schema.catalogs.id, id)).run();
	});
	tx();
	return true;
}

const escLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Autocomplete over the user's catalogs attached to a category: substring match on title/subtitle,
 * title-prefix matches first, then word-prefix, then shorter titles.
 */
export function searchCatalogs(
	userId: string,
	categoryId: string,
	q: string,
	limit = 10,
	db: DB = getDb()
): CatalogEntry[] {
	const text = q.trim().replace(/\s+/g, ' ').slice(0, 100);
	if (!text) return [];
	const e = escLike(text);
	const rows = db.sqlite
		.prepare(
			`SELECT ce.* FROM catalogs c
			 JOIN catalog_entries ce ON ce.source = 'catalog:' || c.id
			 WHERE c.user_id = ? AND c.category_id = ?
			   AND (ce.title LIKE ? ESCAPE '\\' OR ce.subtitle LIKE ? ESCAPE '\\')
			 ORDER BY CASE WHEN ce.title LIKE ? ESCAPE '\\' THEN 0
			               WHEN ce.title LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
			          length(ce.title), ce.title
			 LIMIT ?`
		)
		.all(userId, categoryId, `%${e}%`, `%${e}%`, `${e}%`, `% ${e}%`, Math.min(50, limit)) as {
		id: string;
		source: string;
		external_id: string;
		kind: string;
		title: string;
		subtitle: string | null;
		year: number | null;
		image_url: string | null;
		data: string;
		fetched_at: number;
	}[];
	return rows.map((r) =>
		toCatalogEntry({
			id: r.id,
			source: r.source,
			externalId: r.external_id,
			kind: r.kind,
			title: r.title,
			subtitle: r.subtitle,
			year: r.year,
			imageUrl: r.image_url,
			data: safeJson(r.data),
			fetchedAt: r.fetched_at
		})
	);
}

function safeJson(s: string): Record<string, unknown> {
	try {
		const v = JSON.parse(s);
		return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
	} catch {
		return {};
	}
}
