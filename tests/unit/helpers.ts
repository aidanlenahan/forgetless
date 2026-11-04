import { uuidv7 } from 'uuidv7';
import { createDb, type DB } from '../../src/lib/server/db';
import type { Category, Item, LogEntry } from '../../src/lib/shared/types';

export function makeDb(): DB {
	return createDb(':memory:');
}

export function addUser(
	db: DB,
	id = uuidv7(),
	opts: { guest?: boolean; guestExpiresAt?: number } = {}
) {
	const now = Date.now();
	db.sqlite
		.prepare(
			'INSERT INTO user (id, name, email, email_verified, is_guest, guest_expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
		)
		.run(
			id,
			'Test',
			`${id}@example.test`,
			0,
			opts.guest ? 1 : 0,
			opts.guestExpiresAt ?? null,
			now,
			now
		);
	return id;
}

let t = 1_700_000_000_000;
export const tick = () => (t += 1000);

export function cat(over: Partial<Category> = {}): Category {
	const now = tick();
	return {
		id: uuidv7(),
		name: 'Watch',
		icon: '🎬',
		sort: 0,
		provider: null,
		fieldSchema: [],
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
		...over
	};
}

export function item(categoryId: string, over: Partial<Item> = {}): Item {
	const now = tick();
	return {
		id: uuidv7(),
		categoryId,
		catalogEntryId: null,
		title: 'Something',
		status: 'want',
		recommendedBy: null,
		source: null,
		why: null,
		tags: [],
		customFields: {},
		needsMatch: false,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
		...over
	};
}

export function log(itemId: string, over: Partial<LogEntry> = {}): LogEntry {
	const now = tick();
	return {
		id: uuidv7(),
		itemId,
		date: '2026-01-02',
		rating: null,
		note: null,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
		...over
	};
}
