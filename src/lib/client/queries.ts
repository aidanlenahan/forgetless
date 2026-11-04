// Pure list helpers: filtering, sorting, search and URL (de)serialisation of list filters.
import { STATUSES, type Item, type LogEntry, type Status } from '../shared/types';

export type SortKey = 'added' | 'log' | 'rating' | 'title';
export const SORT_LABELS: Record<SortKey, string> = {
	added: 'Date added',
	log: 'Last logged',
	rating: 'Rating',
	title: 'Title'
};
export const DEFAULT_STATUSES: Status[] = ['want', 'in_progress'];

export interface ListFilters {
	status: Status[];
	tag: string | null;
	by: string | null;
	rated: boolean;
	sort: SortKey;
	q: string;
}

export function parseFilters(sp: { get(key: string): string | null }): ListFilters {
	const rawStatus = sp.get('status');
	let status: Status[] = DEFAULT_STATUSES;
	if (rawStatus === 'all') status = [...STATUSES];
	else if (rawStatus) {
		const s = rawStatus.split(',').filter((x): x is Status => (STATUSES as string[]).includes(x));
		if (s.length) status = s;
	}
	const sort = sp.get('sort') as SortKey | null;
	return {
		status,
		tag: sp.get('tag') || null,
		by: sp.get('by') || null,
		rated: sp.get('rated') === '1',
		sort: sort && sort in SORT_LABELS ? sort : 'added',
		q: sp.get('q') ?? ''
	};
}

const sameSet = (a: string[], b: string[]) =>
	a.length === b.length && a.every((x) => b.includes(x));

/** Serialise to a query string (without "?"), omitting defaults. */
export function serializeFilters(f: ListFilters): string {
	const sp = new URLSearchParams();
	if (!sameSet(f.status, DEFAULT_STATUSES))
		sp.set('status', sameSet(f.status, STATUSES) ? 'all' : f.status.join(','));
	if (f.tag) sp.set('tag', f.tag);
	if (f.by) sp.set('by', f.by);
	if (f.rated) sp.set('rated', '1');
	if (f.sort !== 'added') sp.set('sort', f.sort);
	if (f.q.trim()) sp.set('q', f.q.trim());
	return sp.toString();
}

export function isDefaultFilters(f: ListFilters): boolean {
	return serializeFilters(f) === '';
}

/** Log entries newest first (by date, then creation time). */
export function sortLogs(logs: LogEntry[]): LogEntry[] {
	return [...logs].sort((a, b) =>
		a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1
	);
}

/** Group live (non-deleted) log entries by item, each list newest first. */
export function groupLogs(logs: LogEntry[]): Map<string, LogEntry[]> {
	const m = new Map<string, LogEntry[]>();
	for (const l of logs) {
		if (l.deletedAt) continue;
		const arr = m.get(l.itemId);
		if (arr) arr.push(l);
		else m.set(l.itemId, [l]);
	}
	for (const [k, v] of m) m.set(k, sortLogs(v));
	return m;
}

/** Rating of the most recent log entry that has one (1–10), or null. Expects logs newest first. */
export function latestRating(logs: LogEntry[] | undefined): number | null {
	return logs?.find((l) => l.rating != null)?.rating ?? null;
}
export function lastLogDate(logs: LogEntry[] | undefined): string | null {
	return logs?.[0]?.date ?? null;
}

export function normalize(s: string): string {
	return s.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** Local full-text-ish search across title, recommendedBy, source, why and tags (all terms must match). */
export function matchesText(item: Item, q: string): boolean {
	const terms = normalize(q).split(/\s+/).filter(Boolean);
	if (!terms.length) return true;
	const hay = normalize(
		[
			item.title,
			item.recommendedBy ?? '',
			item.source ?? '',
			item.why ?? '',
			item.tags.join(' ')
		].join(' \u0000 ')
	);
	return terms.every((t) => hay.includes(t));
}

/** Title-only, case-insensitive substring match (for duplicate detection in quick capture). */
export function titleMatches(items: Item[], q: string, limit = 5): Item[] {
	const n = normalize(q.trim());
	if (!n) return [];
	const hits = items.filter((i) => !i.deletedAt && normalize(i.title).includes(n));
	// Exact / prefix matches first.
	const score = (i: Item) => {
		const t = normalize(i.title);
		return t === n ? 0 : t.startsWith(n) ? 1 : 2;
	};
	return hits.sort((a, b) => score(a) - score(b) || b.createdAt - a.createdAt).slice(0, limit);
}

export function filterItems(
	items: Item[],
	f: ListFilters,
	logsByItem: Map<string, LogEntry[]>,
	q: string = f.q
): Item[] {
	const tag = f.tag?.toLowerCase();
	const by = f.by ? normalize(f.by) : null;
	return items.filter(
		(i) =>
			!i.deletedAt &&
			f.status.includes(i.status) &&
			(!tag || i.tags.includes(tag)) &&
			(!by || normalize(i.recommendedBy ?? '') === by) &&
			(!f.rated || latestRating(logsByItem.get(i.id)) != null) &&
			matchesText(i, q)
	);
}

export function sortItems(
	items: Item[],
	sort: SortKey,
	logsByItem: Map<string, LogEntry[]>
): Item[] {
	const arr = [...items];
	switch (sort) {
		case 'title':
			return arr.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
		case 'rating':
			return arr.sort(
				(a, b) =>
					(latestRating(logsByItem.get(b.id)) ?? -1) - (latestRating(logsByItem.get(a.id)) ?? -1) ||
					b.createdAt - a.createdAt
			);
		case 'log':
			return arr.sort((a, b) => {
				const da = lastLogDate(logsByItem.get(a.id)) ?? '';
				const db = lastLogDate(logsByItem.get(b.id)) ?? '';
				return da === db ? b.createdAt - a.createdAt : da < db ? 1 : -1;
			});
		default:
			return arr.sort((a, b) => b.createdAt - a.createdAt);
	}
}

/** Distinct non-empty values, most used first (case-insensitively merged, keeps first spelling). */
export function distinctValues(values: (string | null | undefined)[]): string[] {
	const counts = new Map<string, { v: string; n: number }>();
	for (const raw of values) {
		const v = raw?.trim();
		if (!v) continue;
		const k = v.toLowerCase();
		const e = counts.get(k);
		if (e) e.n++;
		else counts.set(k, { v, n: 1 });
	}
	return [...counts.values()].sort((a, b) => b.n - a.n || a.v.localeCompare(b.v)).map((e) => e.v);
}

export function parseTags(s: string): string[] {
	return [
		...new Set(
			s
				.split(',')
				.map((t) => t.trim().toLowerCase())
				.filter(Boolean)
		)
	];
}
