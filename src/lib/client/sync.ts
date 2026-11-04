// Sync engine: optimistic local writes + ordered outbox flush + incremental pull.
import { localDb } from './db';
import type { Mutation, SyncPullResponse, SyncPushResponse } from '../shared/types';

type SyncState = {
	online: boolean;
	syncing: boolean;
	pending: number;
	lastSyncedAt: number | null;
	error: string | null;
};
const listeners = new Set<(s: SyncState) => void>();
let state: SyncState = {
	online: typeof navigator === 'undefined' ? true : navigator.onLine,
	syncing: false,
	pending: 0,
	lastSyncedAt: null,
	error: null
};
function set(p: Partial<SyncState>) {
	state = { ...state, ...p };
	for (const l of listeners) l(state);
}
/** Svelte-store-compatible readable of sync status. */
export const syncStatus = {
	subscribe(fn: (s: SyncState) => void) {
		listeners.add(fn);
		fn(state);
		return () => listeners.delete(fn);
	}
};

async function refreshPending() {
	set({ pending: await localDb().outbox.count() });
}

/** Apply a mutation locally right away and queue it for the server. */
export async function enqueue(mutations: Mutation[]) {
	const db = localDb();
	await db.transaction('rw', [db.categories, db.items, db.logEntries, db.outbox], async () => {
		for (const m of mutations) {
			if (m.kind === 'category') await db.categories.put(m.row);
			else if (m.kind === 'item') await db.items.put(m.row);
			else await db.logEntries.put(m.row);
			await db.outbox.add({ mutation: m, queuedAt: Date.now(), attempts: 0 });
		}
	});
	await refreshPending();
	void scheduleFlush();
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 1000;
function scheduleFlush(delay = 50) {
	if (flushTimer) clearTimeout(flushTimer);
	flushTimer = setTimeout(() => void syncNow({ pullAfter: false }), delay);
}

async function flushOutbox(): Promise<void> {
	const db = localDb();
	for (;;) {
		const batch = await db.outbox.orderBy('seq').limit(200).toArray();
		if (!batch.length) return;
		const res = await fetch('/api/sync', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ mutations: batch.map((b) => b.mutation) })
		});
		if (res.status === 400) {
			// A malformed mutation would block the queue forever: drop the batch's first row and continue.
			console.warn('[sync] server rejected mutation', await res.text(), batch[0]);
			await db.outbox.delete(batch[0].seq!);
			continue;
		}
		if (!res.ok) throw new Error(`sync push failed: ${res.status}`);
		(await res.json()) as SyncPushResponse;
		await db.outbox.bulkDelete(batch.map((b) => b.seq!));
	}
}

async function pull() {
	const db = localDb();
	const since = ((await db.meta.get('cursor'))?.value as number | undefined) ?? 0;
	const res = await fetch(`/api/sync?since=${since}`);
	if (!res.ok) throw new Error(`sync pull failed: ${res.status}`);
	const data = (await res.json()) as SyncPullResponse;
	// Don't overwrite rows that still have local pending mutations (they're newer).
	const pendingIds = new Set((await db.outbox.toArray()).map((o) => o.mutation.row.id));
	await db.transaction(
		'rw',
		[db.categories, db.items, db.logEntries, db.catalogEntries, db.meta],
		async () => {
			await db.categories.bulkPut(data.categories.filter((r) => !pendingIds.has(r.id)));
			await db.items.bulkPut(data.items.filter((r) => !pendingIds.has(r.id)));
			await db.logEntries.bulkPut(data.logEntries.filter((r) => !pendingIds.has(r.id)));
			await db.catalogEntries.bulkPut(data.catalogEntries);
			await db.meta.put({ key: 'cursor', value: data.cursor });
		}
	);
}

let running: Promise<void> | null = null;
/** Flush outbox then pull changes. Safe to call often; concurrent calls coalesce. */
export function syncNow(opts: { pullAfter?: boolean } = {}): Promise<void> {
	if (running) return running;
	// Checked before creating `running`: an early return inside the async IIFE would run synchronously,
	// before `running` is assigned, leaving a stale resolved promise that blocks every later sync.
	if (typeof navigator !== 'undefined' && !navigator.onLine) {
		set({ online: false });
		return Promise.resolve();
	}
	running = (async () => {
		set({ syncing: true });
		try {
			await flushOutbox();
			if (opts.pullAfter !== false) await pull();
			backoff = 1000;
			set({ online: true, error: null, lastSyncedAt: Date.now() });
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) });
			backoff = Math.min(backoff * 2, 60_000);
			scheduleFlush(backoff);
		} finally {
			await refreshPending();
			set({ syncing: false });
			running = null;
		}
	})();
	return running;
}

/** Wire up online/focus listeners. Call once after the local DB is opened. Returns a cleanup fn. */
export function startSync(): () => void {
	const onOnline = () => {
		set({ online: true });
		void syncNow();
	};
	const onOffline = () => set({ online: false });
	const onFocus = () => void syncNow();
	const onVis = () => document.visibilityState === 'visible' && void syncNow();
	window.addEventListener('online', onOnline);
	window.addEventListener('offline', onOffline);
	window.addEventListener('focus', onFocus);
	document.addEventListener('visibilitychange', onVis);
	const interval = setInterval(() => void syncNow(), 60_000);
	void syncNow();
	return () => {
		window.removeEventListener('online', onOnline);
		window.removeEventListener('offline', onOffline);
		window.removeEventListener('focus', onFocus);
		document.removeEventListener('visibilitychange', onVis);
		clearInterval(interval);
	};
}
