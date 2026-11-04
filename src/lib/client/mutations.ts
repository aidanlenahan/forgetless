// High-level write helpers for the UI. Each one writes locally (optimistic) and queues for sync.
import { uuidv7 } from 'uuidv7';
import { localDb } from './db';
import { enqueue } from './sync';
import type { Category, Item, LogEntry, Status } from '../shared/types';

export const newId = () => uuidv7();
export const today = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function saveCategory(c: Partial<Category> & { name: string }): Promise<Category> {
	const now = Date.now();
	const existing = c.id ? await localDb().categories.get(c.id) : undefined;
	const row: Category = {
		icon: '📌',
		sort: existing?.sort ?? (await localDb().categories.count()),
		provider: null,
		fieldSchema: [],
		createdAt: now,
		deletedAt: null,
		...existing,
		...c,
		id: c.id ?? existing?.id ?? newId(),
		updatedAt: now
	};
	await enqueue([{ kind: 'category', row }]);
	return row;
}

export async function deleteCategory(id: string) {
	const c = await localDb().categories.get(id);
	if (!c) return;
	const now = Date.now();
	// Tombstone the category and all of its items.
	const items = await localDb().items.where('categoryId').equals(id).toArray();
	await enqueue([
		{ kind: 'category', row: { ...c, deletedAt: now, updatedAt: now } },
		...items
			.filter((i) => !i.deletedAt)
			.map((i) => ({ kind: 'item' as const, row: { ...i, deletedAt: now, updatedAt: now } }))
	]);
}

export async function reorderCategories(idsInOrder: string[]) {
	const now = Date.now();
	const rows = await localDb().categories.bulkGet(idsInOrder);
	await enqueue(
		rows
			.filter((r): r is Category => !!r)
			.map((r) => ({
				kind: 'category' as const,
				row: { ...r, sort: idsInOrder.indexOf(r.id), updatedAt: now }
			}))
	);
}

export async function saveItem(
	i: Partial<Item> & { title: string; categoryId: string }
): Promise<Item> {
	const now = Date.now();
	const existing = i.id ? await localDb().items.get(i.id) : undefined;
	const row: Item = {
		catalogEntryId: null,
		status: 'want',
		recommendedBy: null,
		source: null,
		why: null,
		tags: [],
		customFields: {},
		needsMatch: false,
		createdAt: now,
		deletedAt: null,
		...existing,
		...i,
		id: i.id ?? newId(),
		updatedAt: now
	};
	row.tags = [...new Set(row.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
	await enqueue([{ kind: 'item', row }]);
	return row;
}

export async function setItemStatus(id: string, status: Status) {
	const it = await localDb().items.get(id);
	if (it) await saveItem({ ...it, status });
}

export async function deleteItem(id: string) {
	const it = await localDb().items.get(id);
	if (!it) return;
	const now = Date.now();
	await enqueue([{ kind: 'item', row: { ...it, deletedAt: now, updatedAt: now } }]);
}

export async function saveLogEntry(l: Partial<LogEntry> & { itemId: string }): Promise<LogEntry> {
	const now = Date.now();
	const existing = l.id ? await localDb().logEntries.get(l.id) : undefined;
	const row: LogEntry = {
		date: today(),
		rating: null,
		note: null,
		createdAt: now,
		deletedAt: null,
		...existing,
		...l,
		id: l.id ?? newId(),
		updatedAt: now
	};
	await enqueue([{ kind: 'logEntry', row }]);
	return row;
}

export async function deleteLogEntry(id: string) {
	const l = await localDb().logEntries.get(id);
	if (!l) return;
	const now = Date.now();
	await enqueue([{ kind: 'logEntry', row: { ...l, deletedAt: now, updatedAt: now } }]);
}
