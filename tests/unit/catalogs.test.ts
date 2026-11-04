import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	CatalogError,
	createCatalog,
	deleteCatalog,
	listCatalogs,
	parseCatalogUpload,
	searchCatalogs,
	suggestMapping
} from '../../src/lib/server/catalogs';
import { applyMutations, pull } from '../../src/lib/server/repo';
import { purgeExpiredGuests } from '../../src/lib/server/demo';
import type { DB } from '../../src/lib/server/db';
import { makeDb, addUser, cat, item } from './helpers';

const FIX = fileURLToPath(new URL('../fixtures/', import.meta.url));
const games = () =>
	parseCatalogUpload('games.csv', readFileSync(FIX + 'catalog-boardgames.csv', 'utf8'));

let db: DB;
let u: string;
let v: string;

function setup(user: string, name = 'Board games') {
	const c = cat({ name, fieldSchema: [{ key: 'players', label: 'Players', type: 'text' }] });
	applyMutations(user, [{ kind: 'category', row: c }], db);
	return c;
}

beforeEach(() => {
	db = makeDb();
	u = addUser(db);
	v = addUser(db);
});

describe('parse + suggest', () => {
	it('reads ;-separated CSV and suggests a mapping from header names', () => {
		const t = games();
		expect(t.headers).toEqual(['Name', 'Designer', 'Year', 'Players', 'Image']);
		expect(t.rows).toHaveLength(5);
		expect(suggestMapping(t.headers)).toEqual({
			title: 'Name',
			subtitle: 'Designer',
			year: 'Year',
			image: 'Image',
			id: null,
			fields: [{ column: 'Players', key: 'players', label: 'Players' }]
		});
	});

	it('reads a JSON array (or an object holding one)', () => {
		const t = parseCatalogUpload(
			'x.json',
			JSON.stringify({
				items: [{ title: 'Negroni', abv: 24, tags: ['bitter'] }, { title: 'Spritz' }]
			})
		);
		expect(t.headers).toEqual(['title', 'abv', 'tags']);
		expect(t.rows[0]).toEqual({ title: 'Negroni', abv: '24', tags: '["bitter"]' });
		expect(t.rows[1]).toEqual({ title: 'Spritz', abv: '', tags: '' });
		expect(() => parseCatalogUpload('x.json', '{"a":1}')).toThrow(CatalogError);
	});
});

describe('catalogs', () => {
	it('creates rows from the mapping, skips untitled rows and adds new fields to the category', () => {
		const c = setup(u);
		const t = games();
		const { catalog, category } = createCatalog(
			u,
			{
				categoryId: c.id,
				name: 'BGG top',
				mapping: {
					...suggestMapping(t.headers),
					fields: [
						{ column: 'Players', key: 'players', label: 'Players' },
						{ column: 'Year', key: 'year_published', label: 'Year published' }
					]
				},
				table: t,
				addFields: true
			},
			db
		);
		expect(catalog).toMatchObject({ name: 'BGG top', rowCount: 4, categoryId: c.id });
		expect(category.fieldSchema.map((f) => f.key)).toEqual(['players', 'year_published']);
		expect(pull(u, 0, db).categories[0].fieldSchema).toHaveLength(2); // synced to clients
		const [wingspan] = searchCatalogs(u, c.id, 'wingspan', 10, db);
		expect(wingspan).toMatchObject({
			source: `catalog:${catalog.id}`,
			externalId: '1',
			kind: 'catalog',
			title: 'Wingspan',
			subtitle: 'Elizabeth Hargrave',
			year: 2019,
			imageUrl: 'https://example.com/wingspan.jpg',
			data: { catalog: 'BGG top', fields: { players: '1-5', year_published: '2019' } }
		});
		// http:// images are dropped
		expect(searchCatalogs(u, c.id, 'terraforming', 10, db)[0].imageUrl).toBeNull();
		expect(listCatalogs(u, c.id, db)).toHaveLength(1);
		expect(listCatalogs(u, 'other', db)).toHaveLength(0);
	});

	it('validates the mapping', () => {
		const c = setup(u);
		const t = games();
		const base = { categoryId: c.id, name: 'x', table: t, mapping: suggestMapping(t.headers) };
		expect(() => createCatalog(u, { ...base, mapping: { title: 'Nope', fields: [] } }, db)).toThrow(
			/title/
		);
		expect(() => createCatalog(u, { ...base, name: ' ' }, db)).toThrow(/name/);
		expect(() => createCatalog(u, { ...base, maxRows: 2 }, db)).toThrow(/limited to 2/);
		expect(() => createCatalog(v, base, db)).toThrow(/Category not found/);
	});

	it('search ranks prefix matches first and also matches the subtitle', () => {
		const c = setup(u);
		const table = {
			headers: ['t', 's'],
			rows: [
				{ t: 'The Castles of Burgundy', s: 'Stefan Feld' },
				{ t: 'Castle Panic', s: 'Justin De Witt' },
				{ t: 'Carcassonne', s: 'Klaus-Jürgen Wrede' },
				{ t: 'Castles', s: '' },
				{ t: '100% Orange', s: '' }
			]
		};
		createCatalog(
			u,
			{ categoryId: c.id, name: 'g', table, mapping: { title: 't', subtitle: 's', fields: [] } },
			db
		);
		expect(searchCatalogs(u, c.id, 'castle', 10, db).map((e) => e.title)).toEqual([
			'Castles',
			'Castle Panic',
			'The Castles of Burgundy'
		]);
		expect(searchCatalogs(u, c.id, 'wrede', 10, db).map((e) => e.title)).toEqual(['Carcassonne']);
		expect(searchCatalogs(u, c.id, '%', 10, db).map((e) => e.title)).toEqual(['100% Orange']);
		expect(searchCatalogs(u, c.id, 'ca', 2, db)).toHaveLength(2);
	});

	it("never returns another user's catalog rows (search, sync, or by category id)", () => {
		const mine = setup(u);
		const t = games();
		createCatalog(
			u,
			{ categoryId: mine.id, name: 'g', table: t, mapping: suggestMapping(t.headers) },
			db
		);
		expect(searchCatalogs(u, mine.id, 'azul', 10, db)).toHaveLength(1);
		// Someone else asking for the same category id gets nothing.
		expect(searchCatalogs(v, mine.id, 'azul', 10, db)).toEqual([]);
		const theirs = setup(v);
		expect(searchCatalogs(v, theirs.id, 'azul', 10, db)).toEqual([]);

		// Even if they reference the entry id directly, sync doesn't hand it out.
		const [entry] = searchCatalogs(u, mine.id, 'azul', 10, db);
		applyMutations(
			v,
			[{ kind: 'item', row: item(theirs.id, { title: 'Azul', catalogEntryId: entry.id }) }],
			db
		);
		expect(pull(v, 0, db).catalogEntries).toEqual([]);
		applyMutations(
			u,
			[{ kind: 'item', row: item(mine.id, { title: 'Azul', catalogEntryId: entry.id }) }],
			db
		);
		expect(pull(u, 0, db).catalogEntries.map((e) => e.id)).toEqual([entry.id]);
		expect(deleteCatalog(v, listCatalogs(u, null, db)[0].id, db)).toBe(false);
	});

	it('delete removes unreferenced rows and keeps rows items link to', () => {
		const c = setup(u);
		const t = games();
		const { catalog } = createCatalog(
			u,
			{ categoryId: c.id, name: 'g', table: t, mapping: suggestMapping(t.headers) },
			db
		);
		const [azul] = searchCatalogs(u, c.id, 'azul', 10, db);
		applyMutations(
			u,
			[{ kind: 'item', row: item(c.id, { title: 'Azul', catalogEntryId: azul.id }) }],
			db
		);
		expect(deleteCatalog(u, catalog.id, db)).toBe(true);
		expect(listCatalogs(u, null, db)).toEqual([]);
		expect(searchCatalogs(u, c.id, 'a', 10, db)).toEqual([]);
		const left = db.sqlite
			.prepare('SELECT id FROM catalog_entries WHERE source = ?')
			.all(`catalog:${catalog.id}`) as { id: string }[];
		expect(left.map((r) => r.id)).toEqual([azul.id]);
		expect(pull(u, 0, db).catalogEntries.map((e) => e.id)).toEqual([azul.id]);
	});

	it('purging an expired guest removes their catalogs and rows', () => {
		const g = addUser(db, undefined, { guest: true, guestExpiresAt: Date.now() - 1000 });
		const c = setup(g);
		const t = games();
		createCatalog(
			g,
			{ categoryId: c.id, name: 'g', table: t, mapping: suggestMapping(t.headers) },
			db
		);
		expect(purgeExpiredGuests(db)).toBe(1);
		const n = (sql: string) => (db.sqlite.prepare(sql).get() as { n: number }).n;
		expect(n('SELECT COUNT(*) AS n FROM catalogs')).toBe(0);
		expect(n("SELECT COUNT(*) AS n FROM catalog_entries WHERE source LIKE 'catalog:%'")).toBe(0);
	});
});
