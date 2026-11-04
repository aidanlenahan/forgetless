// Provider registry + caching. Search results are cached in-memory (LRU); details are cached in
// catalog_entries (shared across users) and refetched when older than DETAILS_TTL_MS.
import { and, eq } from 'drizzle-orm';
import { getDb, schema, type DB } from '../db';
import { env } from '../env';
import { LruCache } from '../lru';
import { toCatalogEntry, upsertCatalogEntries } from '../repo';
import type { CatalogEntry, CatalogHit } from '../../shared/types';
import { createTmdbProvider } from './tmdb';
import type { Provider, SearchOpts } from './types';

export type { Provider, SearchOpts, ProviderEntry } from './types';
export { ProviderError } from './types';

export const DETAILS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const g = globalThis as unknown as { __appProviders?: Map<string, Provider>; __appSearchCache?: LruCache<CatalogHit[]> };

/** Enabled providers only (a provider without its API key is absent). */
export function getProviders(): Map<string, Provider> {
	if (!g.__appProviders) {
		const m = new Map<string, Provider>();
		if (env.tmdbKey) m.set('tmdb', createTmdbProvider(env.tmdbKey));
		g.__appProviders = m;
	}
	return g.__appProviders;
}

export function getProvider(id: string): Provider | null {
	return getProviders().get(id) ?? null;
}

/** For tests: replace the registry. */
export function setProviders(list: Provider[] | null) {
	g.__appProviders = list ? new Map(list.map((p) => [p.id, p])) : undefined;
	searchCache().clear();
}

function searchCache() {
	return (g.__appSearchCache ??= new LruCache<CatalogHit[]>(500, 10 * 60 * 1000));
}

export async function cachedSearch(provider: Provider, q: string, opts: SearchOpts = {}): Promise<CatalogHit[]> {
	const norm = q.trim().toLowerCase().replace(/\s+/g, ' ');
	const key = `${provider.id}|${opts.kind ?? ''}|${norm}`;
	const cache = searchCache();
	const hit = cache.get(key);
	if (hit) return hit;
	const hits = await provider.search(norm, opts);
	cache.set(key, hits);
	return hits;
}

/** Returns the catalog entry for a provider result, fetching details unless a fresh copy is cached. */
export async function selectEntry(
	provider: Provider,
	externalId: string,
	kind: string | undefined,
	db: DB = getDb(),
	now = Date.now()
): Promise<CatalogEntry> {
	// Normalise via the provider's own id format when it can (e.g. "550"+"movie" -> "movie:550").
	const candidates = [externalId, kind ? `${kind}:${externalId}` : null].filter((x): x is string => !!x);
	for (const ext of candidates) {
		const row = db
			.select()
			.from(schema.catalogEntries)
			.where(and(eq(schema.catalogEntries.source, provider.id), eq(schema.catalogEntries.externalId, ext)))
			.get();
		if (row && now - row.fetchedAt < DETAILS_TTL_MS) return toCatalogEntry(row);
	}
	const details = await provider.getDetails(externalId, kind);
	return upsertCatalogEntries([{ ...details, fetchedAt: now }], db)[0];
}
