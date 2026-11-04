import { describe, it, expect, beforeEach } from 'vitest';
import {
	applyMutations,
	pull,
	wipeUserData,
	searchItems,
	upsertCatalogEntries
} from '../../src/lib/server/repo';
import {
	buildExport,
	importExport,
	toCsv,
	csvField,
	ImportError
} from '../../src/lib/server/export';
import { createCatalog, searchCatalogs } from '../../src/lib/server/catalogs';
import type { DB } from '../../src/lib/server/db';
import type { ExportFile } from '../../src/lib/shared/types';
import { makeDb, addUser, cat, item, log } from './helpers';

let db: DB;
let u: string;

function seed() {
	const [entry] = upsertCatalogEntries(
		[
			{
				source: 'tmdb',
				externalId: 'movie:329865',
				kind: 'movie',
				title: 'Arrival',
				subtitle: 'Movie · 2016',
				year: 2016,
				imageUrl: 'https://image.tmdb.org/t/p/w342/x.jpg',
				data: { overview: 'Aliens', genres: ['Drama'] },
				fetchedAt: 1234
			}
		],
		db
	);
	const watch = cat({ name: 'Watch', provider: 'tmdb' });
	const eat = cat({
		name: 'Eat',
		icon: '🍜',
		sort: 1,
		fieldSchema: [
			{ key: 'neighborhood', label: 'Neighborhood', type: 'text' },
			{ key: 'price', label: 'Price', type: 'select', options: ['$', '$$'] }
		]
	});
	const gone = cat({ name: 'Deleted cat', deletedAt: 10 });
	const a = item(watch.id, {
		title: 'Arrival',
		catalogEntryId: entry.id,
		recommendedBy: 'Sam',
		tags: ['sci-fi', 'imax'],
		status: 'done'
	});
	const b = item(eat.id, {
		title: 'Lucali, "the" pizza',
		why: 'line 1\nline 2',
		customFields: { neighborhood: 'Carroll Gardens', price: '$$' },
		needsMatch: true
	});
	const deleted = item(eat.id, { title: 'Deleted', deletedAt: 99 });
	const l1 = log(a.id, { date: '2026-01-01', rating: 7, note: 'first' });
	const l2 = log(a.id, { date: '2026-03-01', rating: 9, note: 'rewatch' });
	const l3 = log(a.id, { date: '2026-02-01', rating: null, deletedAt: 5 });
	applyMutations(
		u,
		[
			{ kind: 'category', row: watch },
			{ kind: 'category', row: eat },
			{ kind: 'category', row: gone },
			{ kind: 'item', row: a },
			{ kind: 'item', row: b },
			{ kind: 'item', row: deleted },
			{ kind: 'logEntry', row: l1 },
			{ kind: 'logEntry', row: l2 },
			{ kind: 'logEntry', row: l3 }
		],
		db
	);
	return { watch, eat, a, b, entry, l1, l2 };
}

const strip = (f: ExportFile) => ({ ...f, exportedAt: 0 });

beforeEach(() => {
	db = makeDb();
	u = addUser(db);
});

describe('buildExport', () => {
	it('exports only non-deleted rows plus referenced catalog entries', () => {
		const s = seed();
		const f = buildExport(u, db);
		expect(f.format).toBe('forgetless-export');
		expect(f.version).toBe(1);
		expect(f.categories.map((c) => c.name).sort()).toEqual(['Eat', 'Watch']);
		expect(f.items.map((i) => i.id).sort()).toEqual([s.a.id, s.b.id].sort());
		expect(f.logEntries.map((l) => l.id).sort()).toEqual([s.l1.id, s.l2.id].sort());
		expect(f.catalogEntries.map((c) => c.id)).toEqual([s.entry.id]);
	});
});

describe('export → wipe → import round-trip', () => {
	it('restores identical data (replace)', () => {
		seed();
		const before = buildExport(u, db);
		const json = JSON.parse(JSON.stringify(before));
		wipeUserData(u, db);
		expect(buildExport(u, db).items).toHaveLength(0);

		const res = importExport(u, json, 'replace', db);
		expect(res.applied).toBe(
			before.categories.length + before.items.length + before.logEntries.length
		);
		const after = buildExport(u, db);
		expect(strip(after)).toEqual(strip(before));
		// FTS index rebuilt too
		expect(searchItems(u, 'arrival', 50, db)).toHaveLength(1);
	});

	it('round-trips into a fresh instance', () => {
		seed();
		const before = JSON.parse(JSON.stringify(buildExport(u, db))) as ExportFile;
		const db2 = makeDb();
		addUser(db2, u);
		importExport(u, before, 'replace', db2);
		const after = buildExport(u, db2);
		expect(after.categories).toEqual(before.categories);
		expect(after.items).toEqual(before.items);
		expect(after.logEntries).toEqual(before.logEntries);
		// new shared catalog rows are stored stale (fetchedAt=0) so providers refresh them
		expect(after.catalogEntries).toEqual(
			before.catalogEntries.map((c) => ({ ...c, fetchedAt: 0 }))
		);
	});

	it('round-trips items linked to a user catalog entry', () => {
		const s = seed();
		const { catalog } = createCatalog(
			u,
			{
				categoryId: s.eat.id,
				name: 'NYC pizza',
				mapping: {
					title: 'Name',
					subtitle: 'Area',
					fields: [{ column: 'Price', key: 'price', label: 'Price' }]
				},
				table: {
					headers: ['Name', 'Area', 'Price'],
					rows: [
						{ Name: "L'industrie", Area: 'Williamsburg', Price: '$' },
						{ Name: 'Scarr’s', Area: 'LES', Price: '$' }
					]
				}
			},
			db
		);
		const [entry] = searchCatalogs(u, s.eat.id, 'industrie', 10, db);
		expect(entry).toMatchObject({ source: `catalog:${catalog.id}`, subtitle: 'Williamsburg' });
		const c = item(s.eat.id, {
			title: entry.title,
			catalogEntryId: entry.id,
			customFields: { price: '$' }
		});
		applyMutations(u, [{ kind: 'item', row: c }], db);

		const before = buildExport(u, db);
		expect(before.catalogEntries.map((e) => e.id)).toContain(entry.id);
		const json = JSON.parse(JSON.stringify(before));
		wipeUserData(u, db);
		importExport(u, json, 'replace', db);
		expect(strip(buildExport(u, db))).toEqual(strip(before));

		// Into a fresh instance (no catalogs row there): the entry comes along with the item.
		const db2 = makeDb();
		addUser(db2, u);
		importExport(u, json, 'replace', db2);
		const after = buildExport(u, db2);
		expect(after.items.find((i) => i.id === c.id)?.catalogEntryId).toBe(entry.id);
		expect(after.catalogEntries.find((e) => e.id === entry.id)?.title).toBe("L'industrie");

		// Another user importing this file must not get linked to the owner's private entry.
		const v = addUser(db);
		importExport(v, json, 'merge', db);
		const theirs = buildExport(v, db);
		expect(theirs.items.find((i) => i.title === "L'industrie")?.catalogEntryId).toBeNull();
		expect(theirs.catalogEntries.some((e) => e.source.startsWith('catalog:'))).toBe(false);
	});

	it('replace removes rows not in the file', () => {
		seed();
		const file = buildExport(u, db);
		const extra = item(file.categories[0].id, { title: 'Added later' });
		applyMutations(u, [{ kind: 'item', row: extra }], db);
		importExport(u, file, 'replace', db);
		expect(buildExport(u, db).items.find((i) => i.id === extra.id)).toBeUndefined();
	});

	it('merge keeps newer local rows and adds missing ones', () => {
		const s = seed();
		const file = buildExport(u, db);
		applyMutations(
			u,
			[
				{
					kind: 'item',
					row: { ...s.a, title: 'Arrival (edited)', updatedAt: s.a.updatedAt + 10_000 }
				}
			],
			db
		);
		const extra = item(s.watch.id, { title: 'Local only' });
		applyMutations(u, [{ kind: 'item', row: extra }], db);
		const res = importExport(u, file, 'merge', db);
		expect(res.skipped).toBe(1);
		const items = pull(u, 0, db).items;
		expect(items.find((i) => i.id === s.a.id)?.title).toBe('Arrival (edited)');
		expect(items.find((i) => i.id === extra.id)).toBeTruthy();
	});

	it("re-keys rows when importing another user's export on the same instance", () => {
		seed();
		const file = buildExport(u, db);
		const v = addUser(db);
		importExport(v, file, 'merge', db);
		const mine = buildExport(v, db);
		expect(mine.items).toHaveLength(file.items.length);
		expect(mine.items.every((i) => !file.items.some((f) => f.id === i.id))).toBe(true);
		// references remapped consistently
		const catIds = new Set(mine.categories.map((c) => c.id));
		expect(mine.items.every((i) => catIds.has(i.categoryId))).toBe(true);
		const itemIds = new Set(mine.items.map((i) => i.id));
		expect(mine.logEntries.every((l) => itemIds.has(l.itemId))).toBe(true);
		// original owner untouched
		expect(strip(buildExport(u, db))).toEqual(strip(file));
	});

	it('validates format and version', () => {
		expect(() => importExport(u, { format: 'nope' }, 'merge', db)).toThrow(ImportError);
		expect(() =>
			importExport(
				u,
				{ format: 'forgetless-export', version: 2, categories: [], items: [], logEntries: [] },
				'merge',
				db
			)
		).toThrow(/version/);
		expect(() =>
			importExport(
				u,
				{ format: 'forgetless-export', version: 1, categories: {}, items: [], logEntries: [] },
				'merge',
				db
			)
		).toThrow(/categories/);
		expect(() => importExport(u, null, 'merge', db)).toThrow(ImportError);
	});

	it('enforces the item cap and rolls back', () => {
		seed();
		const file = buildExport(u, db);
		const v = addUser(db, undefined, { guest: true });
		expect(() => importExport(v, file, 'replace', db, { itemCap: 1 })).toThrow(/limited to 1/);
		expect(pull(v, 0, db).items).toHaveLength(0);
		importExport(v, file, 'replace', db, { itemCap: 2 });
		expect(pull(v, 0, db).items).toHaveLength(2);
	});
});

describe('CSV', () => {
	it('escapes fields per RFC 4180', () => {
		expect(csvField('plain')).toBe('plain');
		expect(csvField('a,b')).toBe('"a,b"');
		expect(csvField('say "hi"')).toBe('"say ""hi"""');
		expect(csvField('two\nlines')).toBe('"two\nlines"');
		expect(csvField(' padded')).toBe('" padded"');
		expect(csvField(null)).toBe('');
		expect(csvField(4.5)).toBe('4.5');
		expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
	});

	it('builds one CSV per category with custom field columns and latest rating', () => {
		const s = seed();
		const f = buildExport(u, db);
		const eat = f.categories.find((c) => c.id === s.eat.id)!;
		const csv = toCsv(eat, f.items, f.logEntries);
		const lines = csv.split('\r\n');
		expect(lines[0]).toBe(
			'title,status,recommended_by,source,why,tags,created_at,last_logged,latest_rating,Neighborhood,Price'
		);
		expect(lines[1]).toBe(
			`"Lucali, ""the"" pizza",want,,,"line 1\nline 2",,${new Date(s.b.createdAt).toISOString()},,,Carroll Gardens,$$`
		);
		expect(lines).toHaveLength(3); // header, 1 row, trailing ''

		const watch = f.categories.find((c) => c.id === s.watch.id)!;
		const w = toCsv(watch, f.items, f.logEntries).split('\r\n');
		expect(w[1]).toBe(
			`Arrival,done,Sam,,,imax;sci-fi,${new Date(s.a.createdAt).toISOString()},2026-03-01,4.5`
		);
	});
});
