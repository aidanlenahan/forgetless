// Local (IndexedDB) mirror of the user's data + an outbox of pending mutations.
// The UI reads ONLY from here (works offline); see sync.ts for server sync.
import Dexie, { type Table } from 'dexie';
import type { Category, CatalogEntry, Item, LogEntry, Mutation } from '../shared/types';

export interface OutboxRow {
	seq?: number;
	mutation: Mutation;
	queuedAt: number;
	attempts: number;
}
export interface MetaRow {
	key: string;
	value: unknown;
}

export class LocalDB extends Dexie {
	categories!: Table<Category, string>;
	items!: Table<Item, string>;
	logEntries!: Table<LogEntry, string>;
	catalogEntries!: Table<CatalogEntry, string>;
	outbox!: Table<OutboxRow, number>;
	meta!: Table<MetaRow, string>;

	constructor(name: string) {
		super(name);
		this.version(1).stores({
			categories: 'id, sort, updatedAt',
			items: 'id, categoryId, status, createdAt, updatedAt, *tags, recommendedBy, catalogEntryId',
			logEntries: 'id, itemId, date, updatedAt',
			catalogEntries: 'id, [source+externalId]',
			outbox: '++seq',
			meta: 'key'
		});
	}
}

let current: LocalDB | null = null;
let currentUser: string | null = null;

/** Open (or switch to) the per-user local database. Call once after sign-in. */
export function openLocalDb(userId: string): LocalDB {
	if (current && currentUser === userId) return current;
	current?.close();
	current = new LocalDB(`app-${userId}`);
	currentUser = userId;
	return current;
}

export function localDb(): LocalDB {
	if (!current) throw new Error('Local DB not opened; call openLocalDb(userId) first');
	return current;
}

export async function deleteLocalDb(userId: string) {
	if (currentUser === userId) {
		current?.close();
		current = null;
		currentUser = null;
	}
	await Dexie.delete(`app-${userId}`);
}
