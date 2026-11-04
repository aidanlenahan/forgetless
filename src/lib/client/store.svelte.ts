// Reactive in-memory view of the local Dexie DB (the UI reads only from here / Dexie).
// One liveQuery per table; every Dexie write (mutations, sync pulls) re-emits automatically.
import { liveQuery } from 'dexie';
import { localDb } from './db';
import { groupLogs } from './queries';
import type { Category, CatalogEntry, Item, LogEntry } from '../shared/types';

class Store {
	ready = $state(false);
	allCategories = $state.raw<Category[]>([]);
	allItems = $state.raw<Item[]>([]);
	allLogs = $state.raw<LogEntry[]>([]);
	catalog = $state.raw<Map<string, CatalogEntry>>(new Map());

	categories = $derived(
		this.allCategories
			.filter((c) => !c.deletedAt)
			.sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt)
	);
	categoryById = $derived(new Map(this.categories.map((c) => [c.id, c])));
	/** Live items whose category still exists. */
	items = $derived(
		this.allItems.filter((i) => !i.deletedAt && this.categoryById.has(i.categoryId))
	);
	itemById = $derived(new Map(this.items.map((i) => [i.id, i])));
	logsByItem = $derived(groupLogs(this.allLogs));
	wantCounts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const i of this.items)
			if (i.status === 'want') m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1);
		return m;
	});
}

export const store = new Store();

let subs: { unsubscribe(): void }[] = [];
let loaded = 0;

export function startStore() {
	stopStore();
	const db = localDb();
	const mark = () => {
		loaded++;
		if (loaded >= 4) store.ready = true;
	};
	const sub = <T>(q: () => Promise<T>, set: (v: T) => void) => {
		let first = true;
		subs.push(
			liveQuery(q).subscribe({
				next: (v) => {
					set(v);
					if (first) {
						first = false;
						mark();
					}
				},
				error: (e) => console.error('[store]', e)
			})
		);
	};
	sub(
		() => db.categories.toArray(),
		(v) => (store.allCategories = v)
	);
	sub(
		() => db.items.toArray(),
		(v) => (store.allItems = v)
	);
	sub(
		() => db.logEntries.toArray(),
		(v) => (store.allLogs = v)
	);
	sub(
		() => db.catalogEntries.toArray(),
		(v) => (store.catalog = new Map(v.map((c) => [c.id, c])))
	);
}

export function stopStore() {
	for (const s of subs) s.unsubscribe();
	subs = [];
	loaded = 0;
	store.ready = false;
	store.allCategories = [];
	store.allItems = [];
	store.allLogs = [];
	store.catalog = new Map();
}
