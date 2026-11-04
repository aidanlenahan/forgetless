// In-memory, per-user, short-lived storage for parsed uploads between a preview request and the commit
// that follows it, so the file isn't uploaded twice. Single-process only (fine for this app).
import { uuidv7 } from 'uuidv7';

interface Entry {
	userId: string;
	kind: string;
	value: unknown;
	expires: number;
}

const TTL_MS = 30 * 60 * 1000;
const MAX_PER_USER = 4;
const MAX_TOTAL = 200;

const g = globalThis as unknown as { __appStash?: Map<string, Entry> };
const store = () => (g.__appStash ??= new Map());

function sweep(now: number) {
	for (const [k, e] of store()) if (e.expires <= now) store().delete(k);
}

export function stashPut(userId: string, kind: string, value: unknown, now = Date.now()): string {
	sweep(now);
	const s = store();
	const mine = [...s.entries()].filter(([, e]) => e.userId === userId && e.kind === kind);
	for (const [k] of mine.slice(0, Math.max(0, mine.length - MAX_PER_USER + 1))) s.delete(k);
	while (s.size >= MAX_TOTAL) s.delete(s.keys().next().value as string);
	const id = uuidv7();
	s.set(id, { userId, kind, value, expires: now + TTL_MS });
	return id;
}

export function stashGet<T>(id: string, userId: string, kind: string, now = Date.now()): T | null {
	const e = store().get(id);
	if (!e || e.userId !== userId || e.kind !== kind || e.expires <= now) return null;
	return e.value as T;
}

export function stashDelete(id: string) {
	store().delete(id);
}
