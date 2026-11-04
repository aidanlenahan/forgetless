import { describe, it, expect, beforeEach } from 'vitest';
import { purgeExpiredGuests, seedDemoData, markGuest, itemCountAfter, DEMO_ITEMS } from '../../src/lib/server/demo';
import { applyMutations, pull, searchItems } from '../../src/lib/server/repo';
import { seedDefaultCategories } from '../../src/lib/server/seed';
import type { DB } from '../../src/lib/server/db';
import { makeDb, addUser, cat, item, log } from './helpers';

let db: DB;
beforeEach(() => {
	db = makeDb();
});

const count = (sql: string, ...args: unknown[]) => (db.sqlite.prepare(sql).get(...args) as { n: number }).n;

describe('purgeExpiredGuests', () => {
	it('deletes expired guests and all their data, keeps others', () => {
		const now = Date.now();
		const expired = addUser(db, undefined, { guest: true, guestExpiresAt: now - 1 });
		const fresh = addUser(db, undefined, { guest: true, guestExpiresAt: now + 60_000 });
		const regular = addUser(db);
		for (const u of [expired, fresh, regular]) {
			const c = cat();
			const i = item(c.id, { title: 'Severance', tags: ['x'] });
			applyMutations(u, [{ kind: 'category', row: c }, { kind: 'item', row: i }, { kind: 'logEntry', row: log(i.id) }], db);
		}
		db.sqlite
			.prepare("INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES ('s1', ?, 't1', ?, ?, ?)")
			.run(now + 1e6, now, now, expired);

		expect(purgeExpiredGuests(db, now)).toBe(1);
		expect(count('SELECT COUNT(*) AS n FROM user WHERE id = ?', expired)).toBe(0);
		for (const t of ['categories', 'items', 'log_entries', 'items_fts', 'session'])
			expect(count(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, expired)).toBe(0);
		expect(count('SELECT COUNT(*) AS n FROM item_tags')).toBe(2);
		expect(searchItems(fresh, 'severance', 50, db)).toHaveLength(1);
		expect(searchItems(regular, 'severance', 50, db)).toHaveLength(1);
		expect(purgeExpiredGuests(db, now)).toBe(0);
	});
});

describe('seedDemoData', () => {
	it('creates realistic sample data across default categories', () => {
		const u = addUser(db);
		seedDefaultCategories(u, db);
		markGuest(u, db, 1000, 5000);
		const res = seedDemoData(u, db);
		const p = pull(u, 0, db);
		expect(p.items).toHaveLength(DEMO_ITEMS.length);
		expect(p.items.length).toBeGreaterThanOrEqual(20);
		expect(res.skipped).toBe(0);
		expect(new Set(p.items.map((i) => p.categories.find((c) => c.id === i.categoryId)?.name)).size).toBe(6);
		expect(p.logEntries.length).toBeGreaterThan(8);
		expect(p.catalogEntries.length).toBeGreaterThanOrEqual(4);
		expect(p.catalogEntries.every((c) => c.imageUrl?.startsWith('https://image.tmdb.org/'))).toBe(true);
		const oldest = Math.min(...p.items.map((i) => i.createdAt));
		expect(Date.now() - oldest).toBeGreaterThan(200 * 86_400_000);
		expect(db.sqlite.prepare('SELECT is_guest, guest_expires_at FROM user WHERE id = ?').get(u)).toEqual({
			is_guest: 1,
			guest_expires_at: 6000
		});
		// seeding twice for different guests shares catalog rows
		const v = addUser(db);
		seedDemoData(v, db);
		expect(count('SELECT COUNT(*) AS n FROM catalog_entries')).toBe(p.catalogEntries.length);
	});
});

describe('itemCountAfter (guest cap)', () => {
	it('counts only new, non-deleted items', () => {
		const u = addUser(db);
		const c = cat();
		const a = item(c.id);
		applyMutations(u, [{ kind: 'category', row: c }, { kind: 'item', row: a }], db);
		const b = item(c.id);
		expect(
			itemCountAfter(
				u,
				[
					{ kind: 'item', row: { ...a, title: 'edit' } },
					{ kind: 'item', row: b },
					{ kind: 'item', row: { ...b, title: 'again' } },
					{ kind: 'item', row: item(c.id, { deletedAt: 1 }) },
					{ kind: 'category', row: cat() }
				],
				db
			)
		).toBe(2);
	});
});
