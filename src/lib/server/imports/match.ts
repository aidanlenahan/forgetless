// Matches import records to provider (TMDB) entries. IMDb ids use the exact /find lookup; everything else
// searches by title and accepts a result whose normalised title is equal and year is within ±1.
// Calls go through the shared search LRU and the catalog_entries cache (selectEntry), are limited to a few
// at a time and back off on 429.
import type { DB } from '../db';
import { cachedSearch, selectEntry, ProviderError, type Provider } from '../providers';
import type { CatalogEntry, CatalogHit } from '../../shared/types';
import type { ImportRecord } from './types';
import { normTitle } from './util';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface MatchOptions {
	db: DB;
	provider: Provider | null;
	sleep?: (ms: number) => Promise<void>;
	maxRetries?: number;
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	opts: Pick<MatchOptions, 'sleep' | 'maxRetries'> = {}
): Promise<T> {
	const wait = opts.sleep ?? sleep;
	const max = opts.maxRetries ?? 5;
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (e) {
			if (e instanceof ProviderError && e.status === 429 && attempt < max) {
				await wait(e.retryAfter ? e.retryAfter * 1000 : Math.min(500 * 2 ** attempt, 10_000));
				continue;
			}
			throw e;
		}
	}
}

/** Runs `fn` over `items` with at most `n` in flight. Results keep input order. */
export async function mapLimit<T, R>(
	items: T[],
	n: number,
	fn: (x: T, i: number) => Promise<R>
): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
	return out;
}

/** Best search hit: same normalised title and year within ±1 (closest year first). */
export function bestHit(hits: CatalogHit[], title: string, year: number | null): CatalogHit | null {
	const t = normTitle(title);
	const ok = hits.filter(
		(h) =>
			normTitle(h.title) === t && (year == null || (h.year != null && Math.abs(h.year - year) <= 1))
	);
	if (!ok.length) return null;
	if (year == null) return ok[0];
	return [...ok].sort((a, b) => Math.abs(a.year! - year) - Math.abs(b.year! - year))[0];
}

export const matchable = (rec: ImportRecord) => rec.kind === 'movie' || rec.kind === 'tv';

/** Returns the catalog entry for a record, or null when there's no confident match (or no provider). */
export async function matchRecord(
	rec: ImportRecord,
	opts: MatchOptions
): Promise<CatalogEntry | null> {
	const { provider, db } = opts;
	if (!provider || !matchable(rec)) return null;
	const kind = rec.kind as 'movie' | 'tv';
	const select = (hit: CatalogHit) =>
		withRetry(() => selectEntry(provider, hit.externalId, hit.kind, db), opts);
	try {
		if (rec.imdbId && provider.findByExternalId) {
			const hits = await withRetry(() => provider.findByExternalId!('imdb', rec.imdbId!), opts);
			const hit = hits.find((h) => h.kind === kind) ?? hits[0];
			if (hit) return await select(hit);
		}
		if (!provider.kinds.includes(kind)) return null;
		let hit: CatalogHit | null = null;
		if (rec.year) {
			const hits = await withRetry(
				() => cachedSearch(provider, rec.title, { kind, year: rec.year! }),
				opts
			);
			hit = bestHit(hits, rec.title, rec.year);
		}
		if (!hit) {
			const hits = await withRetry(() => cachedSearch(provider, rec.title, { kind }), opts);
			hit = bestHit(hits, rec.title, rec.year);
		}
		return hit ? await select(hit) : null;
	} catch (e) {
		if (e instanceof ProviderError) return null; // provider down / not found: import as custom
		throw e;
	}
}
