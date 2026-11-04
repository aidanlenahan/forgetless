// Client wrappers for the server-side provider proxy (TMDB, places from OpenStreetMap).
import { localDb } from './db';
import type { CatalogEntry, CatalogHit } from '../shared/types';
import type { PlacePreference } from '../shared/places';

export class ProviderError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}

export interface SearchExtras {
	/** Location bias for places (only when the user turned on "Near me"). */
	lat?: number;
	lon?: number;
	prefer?: PlacePreference | null;
}

export async function searchProvider(
	provider: string,
	q: string,
	signal?: AbortSignal,
	extras: SearchExtras = {}
): Promise<CatalogHit[]> {
	const params = new URLSearchParams({ q });
	if (extras.lat != null && extras.lon != null) {
		params.set('lat', extras.lat.toFixed(2));
		params.set('lon', extras.lon.toFixed(2));
	}
	if (extras.prefer) params.set('prefer', extras.prefer);
	const r = await fetch(`/api/providers/${encodeURIComponent(provider)}/search?${params}`, {
		signal
	});
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

export const KIND_LABELS: Record<string, string> = {
	movie: 'Movie',
	tv: 'TV',
	catalog: 'Catalog',
	restaurant: 'Restaurant',
	fast_food: 'Fast food',
	cafe: 'Café',
	bar: 'Bar',
	pub: 'Pub',
	place: 'Place'
};

/** Human names for category databases (Settings, capture, link modal). */
export const PROVIDER_LABELS: Record<string, string> = {
	tmdb: 'TMDB (movies & TV)',
	osm: 'Places (OpenStreetMap)'
};
/** Is provider `id` enabled on this server (per /api/config)? */
export function providerEnabled(
	config: { providers: Record<string, boolean | undefined> },
	id: string | null | undefined
): boolean {
	return !!id && !!config.providers[id];
}

export const PROVIDER_SHORT: Record<string, string> = { tmdb: 'TMDB', osm: 'OpenStreetMap' };

export { OSM_ATTRIBUTION, placePreference, type PlacePreference } from '../shared/places';
export const kindLabel = (k: string | null | undefined) => (k ? (KIND_LABELS[k] ?? k) : '');

/** "2024 · TV" plus the entry subtitle only when it adds something beyond year/kind. */
export function entryMeta(
	e:
		| { year: number | null; kind: string; subtitle: string | null; source?: string }
		| null
		| undefined
): string {
	if (!e) return '';
	// Place subtitles already read "Ramen · East Village, New York".
	if (e.source === 'osm') return e.subtitle?.trim() || kindLabel(e.kind);
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
