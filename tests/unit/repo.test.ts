import { describe, it, expect, beforeEach } from 'vitest';
import {
	applyMutations,
	pull,
	searchItems,
	MutationError,
	wipeUserData
} from '../../src/lib/server/repo';
import type { DB } from '../../src/lib/server/db';
import { makeDb, addUser, cat, item, log } from './helpers';

let db: DB;
let u: string;
beforeEach(() => {
	db = makeDb();
	u = addUser(db);
});

describe('applyMutations (LWW)', () => {
	it('applies newer updates and skips older ones', () => {
		const c = cat();
		const i = item(c.id, { title: 'v1', updatedAt: 1000 });
		applyMutations(
			u,
			[
				{ kind: 'category', row: c },
				{ kind: 'item', row: i }
			],
			db
		);

		const older = applyMutations(
			u,
			[{ kind: 'item', row: { ...i, title: 'older', updatedAt: 999 } }],
			db
		);
		expect(older).toEqual({ applied: 0, skipped: 1 });
		expect(pull(u, 0, db).items[0].title).toBe('v1');

		const newer = applyMutations(
			u,
			[{ kind: 'item', row: { ...i, title: 'newer', updatedAt: 2000 } }],
			db
		);
		expect(newer).toEqual({ applied: 1, skipped: 0 });
		expect(pull(u, 0, db).items[0].title).toBe('newer');
	});

	it('rejects rows owned by another user', () => {
		const other = addUser(db);
		const c = cat();
		applyMutations(other, [{ kind: 'category', row: c }], db);
		expect(() =>
			applyMutations(
				u,
				[{ kind: 'category', row: { ...c, name: 'mine', updatedAt: c.updatedAt + 1 } }],
				db
			)
		).toThrow(MutationError);
		const i = item(c.id);
		applyMutations(other, [{ kind: 'item', row: i }], db);
		expect(() =>
			applyMutations(u, [{ kind: 'item', row: { ...i, updatedAt: i.updatedAt + 5 } }], db)
		).toThrow(MutationError);
		// other user's data unchanged and invisible to u
		expect(pull(other, 0, db).categories[0].name).toBe('Watch');
		expect(pull(u, 0, db).items).toHaveLength(0);
	});

	it('rolls back the whole batch on an invalid row', () => {
		const c = cat();
		expect(() =>
			applyMutations(
				u,
				[
					{ kind: 'category', row: c },
					{ kind: 'item', row: item(c.id, { title: '  ' }) }
				],
				db
			)
		).toThrow(MutationError);
		expect(pull(u, 0, db).categories).toHaveLength(0);
	});
});

describe('pull', () => {
	it('returns tombstones', () => {
		const c = cat();
		const i = item(c.id);
		applyMutations(
			u,
			[
				{ kind: 'category', row: c },
				{ kind: 'item', row: i }
			],
			db
		);
		applyMutations(
			u,
			[{ kind: 'item', row: { ...i, deletedAt: i.updatedAt + 1, updatedAt: i.updatedAt + 1 } }],
			db
		);
		const p = pull(u, 0, db);
		expect(p.items).toHaveLength(1);
		expect(p.items[0].deletedAt).toBe(i.updatedAt + 1);
	});

	it('is incremental from the since-cursor', () => {
		const c = cat();
		const a = item(c.id, { title: 'a' });
		applyMutations(
			u,
			[
				{ kind: 'category', row: c },
				{ kind: 'item', row: a }
			],
			db
		);
		const first = pull(u, 0, db);
		expect(first.categories).toHaveLength(1);
		expect(first.items).toHaveLength(1);

		const b = item(c.id, { title: 'b' });
		const l = log(a.id, { rating: 8 });
		applyMutations(
			u,
			[
				{ kind: 'item', row: b },
				{ kind: 'logEntry', row: l }
			],
			db
		);
		const second = pull(u, first.cursor, db);
		expect(second.categories).toHaveLength(0);
		expect(second.items.map((x) => x.title)).toEqual(['b']);
		expect(second.logEntries.map((x) => x.id)).toEqual([l.id]);
		expect(second.cursor).toBeGreaterThan(first.cursor);

		expect(pull(u, second.cursor, db).items).toHaveLength(0);
	});

	it('includes referenced catalog entries', () => {
		db.sqlite
			.prepare(
				"INSERT INTO catalog_entries (id, source, external_id, kind, title, data, fetched_at) VALUES ('tmdb-movie-1','tmdb','movie:1','movie','X','{}',1)"
			)
			.run();
		const c = cat();
		applyMutations(
			u,
			[
				{ kind: 'category', row: c },
				{ kind: 'item', row: item(c.id, { catalogEntryId: 'tmdb-movie-1' }) }
			],
			db
		);
		expect(pull(u, 0, db).catalogEntries.map((e) => e.id)).toEqual(['tmdb-movie-1']);
	});
});

describe('tags', () => {
	it('normalizes: trims, lower-cases, de-duplicates, sorts', () => {
		const c = cat();
		const i = item(c.id, {
			tags: [' Sci-Fi ', 'sci-fi', 'IMAX', '', 'binge', 42 as unknown as string]
		});
		applyMutations(
			u,
			[
				{ kind: 'category', row: c },
				{ kind: 'item', row: i }
			],
			db
		);
		expect(pull(u, 0, db).items[0].tags).toEqual(['binge', 'imax', 'sci-fi']);
		applyMutations(
			u,
			[{ kind: 'item', row: { ...i, tags: ['new'], updatedAt: i.updatedAt + 1 } }],
			db
		);
		expect(pull(u, 0, db).items[0].tags).toEqual(['new']);
	});
});

describe('searchItems (FTS)', () => {
	it('finds own items by title prefix, recommender, why and tags; excludes deleted and other users', () => {
		const c = cat();
		const a = item(c.id, { title: 'Severance', recommendedBy: 'Sam', tags: ['sci-fi'] });
		const b = item(c.id, { title: 'Past Lives', why: 'bring tissues', tags: ['date night'] });
		const d = item(c.id, { title: 'Severed Deleted', deletedAt: 5 });
		applyMutations(
			u,
			[{ kind: 'category', row: c }, ...[a, b, d].map((row) => ({ kind: 'item' as const, row }))],
			db
		);
		const other = addUser(db);
		const oc = cat();
		applyMutations(
			other,
			[
				{ kind: 'category', row: oc },
				{ kind: 'item', row: item(oc.id, { title: 'Severance' }) }
			],
			db
		);

		expect(searchItems(u, 'sever', 50, db)).toEqual([a.id]);
		expect(searchItems(u, 'sam', 50, db)).toEqual([a.id]);
		expect(searchItems(u, 'tissues', 50, db)).toEqual([b.id]);
		expect(searchItems(u, 'night', 50, db)).toEqual([b.id]);
		expect(searchItems(u, 'past liv', 50, db)).toEqual([b.id]);
		expect(searchItems(u, '"*():^', 50, db)).toEqual([]);
		expect(searchItems(u, 'nothing-here', 50, db)).toEqual([]);
	});

	it('updates when an item is renamed and clears on wipe', () => {
		const c = cat();
		const a = item(c.id, { title: 'Arrival' });
		applyMutations(
			u,
			[
				{ kind: 'category', row: c },
				{ kind: 'item', row: a }
			],
			db
		);
		applyMutations(
			u,
			[{ kind: 'item', row: { ...a, title: 'Dune', updatedAt: a.updatedAt + 1 } }],
			db
		);
		expect(searchItems(u, 'arrival', 50, db)).toEqual([]);
		expect(searchItems(u, 'dune', 50, db)).toEqual([a.id]);
		wipeUserData(u, db);
		expect(searchItems(u, 'dune', 50, db)).toEqual([]);
	});
});
