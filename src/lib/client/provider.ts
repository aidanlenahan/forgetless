// Client wrappers for the server-side provider proxy (TMDB).
import { localDb } from './db';
import type { CatalogEntry, CatalogHit } from '../shared/types';

export class ProviderError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}

export async function searchProvider(
	provider: string,
	q: string,
	signal?: AbortSignal
): Promise<CatalogHit[]> {
	const r = await fetch(
		`/api/providers/${encodeURIComponent(provider)}/search?q=${encodeURIComponent(q)}`,
		{ signal }
	);
	if (!r.ok)
		throw new ProviderError(
			r.status === 429 ? 'Too many searches, slow down a little' : `Search failed (${r.status})`,
			r.status
		);
	const body = (await r.json()) as { hits?: CatalogHit[] };
	return body.hits ?? [];
}

/** Fetch full details for a hit, cache the entry locally, and return it. */
export async function selectProviderHit(
	provider: string,
	hit: Pick<CatalogHit, 'externalId' | 'kind'>
): Promise<CatalogEntry> {
	const r = await fetch(`/api/providers/${encodeURIComponent(provider)}/select`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ externalId: hit.externalId, kind: hit.kind })
	});
	if (!r.ok) throw new ProviderError(`Could not load details (${r.status})`, r.status);
	const { entry } = (await r.json()) as { entry: CatalogEntry };
	await localDb().catalogEntries.put(entry);
	return entry;
}

export const KIND_LABELS: Record<string, string> = { movie: 'Movie', tv: 'TV', catalog: 'Catalog' };
export const kindLabel = (k: string | null | undefined) => (k ? (KIND_LABELS[k] ?? k) : '');

/** "2024 · TV" plus the entry subtitle only when it adds something beyond year/kind. */
export function entryMeta(
	e: { year: number | null; kind: string; subtitle: string | null } | null | undefined
): string {
	if (!e) return '';
	const parts: string[] = [];
	if (e.year) parts.push(String(e.year));
	if (e.kind) parts.push(kindLabel(e.kind));
	const sub = e.subtitle?.trim();
	if (sub) {
		const rest = sub
			.split(/\s*[·•|,-]\s*/)
			.filter(
				(x) =>
					x &&
					x !== String(e.year) &&
					x.toLowerCase() !== kindLabel(e.kind).toLowerCase() &&
					x.toLowerCase() !== e.kind
			);
		if (rest.length) parts.push(rest.join(' · '));
	}
	return parts.join(' · ');
}
