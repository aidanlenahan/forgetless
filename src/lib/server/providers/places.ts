// Places provider (id 'osm') backed by OpenStreetMap data.
// - Search: Photon (komoot), which is built for search-as-you-type. Nominatim's usage policy forbids
//   autocomplete, so it is never used for search.
// - Details: built from the Photon feature the user picked (remembered in memory for a few hours) plus an
//   optional Nominatim /lookup for extratags (opening hours, website, phone, cuisine). Nominatim is
//   throttled to 1 req/s, sends a descriptive User-Agent, and is skipped quietly when it fails or is busy.
// External ids are "node:123" / "way:456" / "relation:789" (OSM ids are only unique per element type).
// Data is © OpenStreetMap contributors, ODbL: the attribution must be shown wherever results are shown.
import type { CatalogHit } from '../../shared/types';
import { OSM_ATTRIBUTION } from '../../shared/places';
import { LruCache } from '../lru';
import { Throttle } from './throttle';
import {
	ProviderError,
	type FetchLike,
	type PlacePreference,
	type Provider,
	type ProviderEntry,
	type SearchOpts
} from './types';

export const PLACE_KINDS = ['restaurant', 'fast_food', 'cafe', 'bar', 'pub', 'place'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export { OSM_ATTRIBUTION };

const DAY = 24 * 60 * 60 * 1000;
export const PLACES_DETAILS_TTL_MS = 30 * DAY;

type OsmType = 'node' | 'way' | 'relation';
const TYPE_BY_LETTER: Record<string, OsmType> = { N: 'node', W: 'way', R: 'relation' };
const LETTER_BY_TYPE: Record<OsmType, string> = { node: 'N', way: 'W', relation: 'R' };

export interface PlaceAddress {
	housenumber?: string;
	street?: string;
	/** neighbourhood / locality */
	locality?: string;
	/** borough / suburb / district */
	district?: string;
	city?: string;
	county?: string;
	state?: string;
	postcode?: string;
	country?: string;
	countrycode?: string;
}

/** What we know about one OSM element, from Photon and/or Nominatim. */
export interface PlaceFacts {
	osmType: OsmType;
	osmId: string;
	name: string | null;
	key: string | null;
	value: string | null;
	lat: number | null;
	lon: number | null;
	address: PlaceAddress;
	tags: Record<string, string>;
}

export interface PhotonFeature {
	type?: string;
	geometry?: { type?: string; coordinates?: [number, number] };
	properties?: {
		osm_type?: string;
		osm_id?: number | string;
		osm_key?: string;
		osm_value?: string;
		type?: string;
		name?: string;
		housenumber?: string;
		street?: string;
		locality?: string;
		district?: string;
		city?: string;
		county?: string;
		state?: string;
		postcode?: string;
		country?: string;
		countrycode?: string;
		extra?: Record<string, unknown>;
	};
}

export interface NominatimPlace {
	osm_type?: string;
	osm_id?: number | string;
	lat?: string;
	lon?: string;
	category?: string;
	class?: string;
	type?: string;
	name?: string;
	display_name?: string;
	address?: Record<string, string>;
	extratags?: Record<string, string> | null;
}

// ---------- ids ----------

/** Parses "node:123", "way/456", "N123" or "r789" into { type, id, externalId }. */
export function parseOsmId(externalId: string): {
	type: OsmType;
	id: string;
	externalId: string;
	letter: string;
} {
	const s = externalId.trim();
	let type: OsmType | undefined;
	let id: string | undefined;
	const long = /^(node|way|relation)[:/](\d{1,15})$/i.exec(s);
	if (long) {
		type = long[1].toLowerCase() as OsmType;
		id = long[2];
	} else {
		const short = /^([NWR])(\d{1,15})$/i.exec(s);
		if (short) {
			type = TYPE_BY_LETTER[short[1].toUpperCase()];
			id = short[2];
		}
	}
	if (!type || !id) throw new ProviderError('invalid OpenStreetMap id', 400);
	return { type, id, externalId: `${type}:${id}`, letter: LETTER_BY_TYPE[type] };
}

export const osmUrl = (type: OsmType, id: string) => `https://www.openstreetmap.org/${type}/${id}`;

// ---------- classification ----------

const AMENITY_KIND: Record<string, PlaceKind> = {
	restaurant: 'restaurant',
	fast_food: 'fast_food',
	food_court: 'fast_food',
	cafe: 'cafe',
	ice_cream: 'cafe',
	bar: 'bar',
	pub: 'pub',
	biergarten: 'pub'
};

export function placeKind(key: string | null | undefined, value: string | null | undefined) {
	return (key === 'amenity' && value && AMENITY_KIND[value]) || 'place';
}

/** Keys that are never a "place" on their own: streets, rails, entrances, plain addresses. */
const NON_POI_KEYS = new Set([
	'highway',
	'railway',
	'route',
	'power',
	'barrier',
	'entrance',
	'addr',
	'junction',
	'public_transport'
]);
/** place=* values that are addresses or map labels rather than somewhere you'd go. */
const NOISE_PLACES = new Set([
	'house',
	'postcode',
	'isolated_dwelling',
	'farm',
	'plot',
	'locality'
]);
/** Photon tag filters (OR-ed) for food and drink categories: without them a bare name ("katz") is
 * swamped by towns and villages. Visit is left unfiltered because cities are fine places to visit. */
export const PREFER_TAGS: Partial<Record<PlacePreference, string[]>> = {
	eat: ['amenity', 'shop', 'craft'],
	drink: ['amenity', 'shop', 'craft']
};

/** Named but not a point of interest: areas (cities, islands), buildings, land use. Kept, ranked lower. */
const AREA_KEYS = new Set(['place', 'boundary', 'building', 'landuse', 'waterway']);

/** 0 = point of interest, 1 = named area or building, 2 = street / house / address (dropped if possible). */
export function poiTier(f: Pick<PlaceFacts, 'name' | 'key' | 'value'>): 0 | 1 | 2 {
	if (!f.name || !f.key) return 2;
	if (NON_POI_KEYS.has(f.key)) return 2;
	if (f.key === 'place' && NOISE_PLACES.has(f.value ?? '')) return 2;
	if (AREA_KEYS.has(f.key)) return 1;
	return 0;
}

const PREFER: Record<PlacePreference, (key: string, value: string) => boolean> = {
	eat: (k, v) =>
		(k === 'amenity' &&
			['restaurant', 'fast_food', 'cafe', 'food_court', 'ice_cream', 'biergarten'].includes(v)) ||
		(k === 'shop' &&
			['bakery', 'deli', 'pastry', 'confectionery', 'chocolate', 'cheese'].includes(v)),
	drink: (k, v) =>
		(k === 'amenity' && ['bar', 'pub', 'cafe', 'biergarten', 'nightclub'].includes(v)) ||
		(k === 'shop' && ['wine', 'alcohol', 'beverages', 'coffee', 'tea'].includes(v)) ||
		(k === 'craft' && ['brewery', 'winery', 'distillery'].includes(v)),
	visit: (k, v) =>
		['tourism', 'leisure', 'historic', 'natural', 'place', 'boundary'].includes(k) ||
		(k === 'amenity' &&
			['theatre', 'arts_centre', 'library', 'cinema', 'place_of_worship', 'marketplace'].includes(
				v
			)) ||
		(k === 'building' && ['cathedral', 'church', 'temple', 'mosque', 'castle'].includes(v))
};

export function matchesPreference(
	f: Pick<PlaceFacts, 'key' | 'value'>,
	prefer: PlacePreference | undefined
): boolean {
	return !!prefer && !!f.key && PREFER[prefer](f.key, f.value ?? '');
}

// ---------- labels ----------

const VALUE_LABEL: Record<string, string> = {
	fast_food: 'Fast food',
	ice_cream: 'Ice cream',
	cafe: 'Café',
	pub: 'Pub',
	biergarten: 'Beer garden',
	place_of_worship: 'Place of worship',
	arts_centre: 'Arts centre',
	nature_reserve: 'Nature reserve',
	viewpoint: 'Viewpoint',
	attraction: 'Attraction'
};
const KEY_LABEL: Record<string, string> = {
	tourism: 'Attraction',
	historic: 'Historic site',
	leisure: 'Leisure',
	natural: 'Nature',
	building: 'Building',
	shop: 'Shop',
	amenity: 'Place',
	place: 'Place'
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "restaurant" -> "Restaurant", "fast_food" -> "Fast food", tourism=yes -> "Attraction". */
export function typeLabel(key: string | null, value: string | null): string | null {
	if (!value || value === 'yes')
		return key ? (KEY_LABEL[key] ?? cap(key.replace(/_/g, ' '))) : null;
	return VALUE_LABEL[value] ?? cap(value.replace(/_/g, ' '));
}

/** OSM cuisine tags look like "ramen;japanese" or "coffee_shop". Returns "Ramen". */
export function cuisineLabel(cuisine: string | null | undefined): string | null {
	const first = cuisine?.split(/[;,]/)[0]?.trim();
	return first ? cap(first.replace(/_/g, ' ')) : null;
}

/** Junk "localities" that read badly in a subtitle (NYC community boards, etc.). */
const JUNK_AREA = /community board|^unnamed/i;

/** "East Village, New York": the most specific neighbourhood-ish part plus the city (or state/country). */
export function areaLabel(a: PlaceAddress, name?: string | null): string | null {
	const ok = (x: string | undefined) => (x && !JUNK_AREA.test(x) && x !== name ? x : undefined);
	const near = ok(a.locality) ?? ok(a.district);
	const town = ok(a.city) ?? ok(a.county);
	const parts = [near, town].filter((x, i, arr): x is string => !!x && arr.indexOf(x) === i);
	if (parts.length < 2) {
		const wide = ok(a.state) ?? ok(a.country);
		if (wide && !parts.includes(wide)) parts.push(wide);
	}
	return parts.length ? parts.join(', ') : null;
}

export function placeSubtitle(f: PlaceFacts): string | null {
	const what = cuisineLabel(f.tags.cuisine) ?? typeLabel(f.key, f.value);
	const where = areaLabel(f.address, f.name);
	return [what, where].filter(Boolean).join(' · ') || null;
}

/** "205 East Houston Street, Manhattan, New York 10002, United States" */
export function formatAddress(a: PlaceAddress): string | null {
	const line1 = [a.housenumber, a.street].filter(Boolean).join(' ');
	const near = a.district && !JUNK_AREA.test(a.district) ? a.district : undefined;
	const cityLine = [a.city ?? a.county, a.postcode].filter(Boolean).join(' ');
	const parts = [line1, near, cityLine || a.state, a.country].filter(
		(x, i, arr): x is string => !!x && arr.indexOf(x) === i
	);
	return parts.length ? parts.join(', ') : null;
}

// ---------- mapping ----------

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function factsFromPhoton(feature: PhotonFeature): PlaceFacts | null {
	const p = feature.properties;
	const type = p?.osm_type ? TYPE_BY_LETTER[p.osm_type.toUpperCase()] : undefined;
	if (!p || !type || p.osm_id == null || !/^\d+$/.test(String(p.osm_id))) return null;
	const [lon, lat] = feature.geometry?.coordinates ?? [];
	const tags: Record<string, string> = {};
	for (const [k, v] of Object.entries(p.extra ?? {})) if (typeof v === 'string') tags[k] = v;
	return {
		osmType: type,
		osmId: String(p.osm_id),
		name: str(p.name) ?? null,
		key: str(p.osm_key) ?? null,
		value: str(p.osm_value) ?? null,
		lat: typeof lat === 'number' && Number.isFinite(lat) ? lat : null,
		lon: typeof lon === 'number' && Number.isFinite(lon) ? lon : null,
		address: {
			housenumber: str(p.housenumber),
			street: str(p.street),
			locality: str(p.locality),
			district: str(p.district),
			city: str(p.city),
			county: str(p.county),
			state: str(p.state),
			postcode: str(p.postcode),
			country: str(p.country),
			countrycode: str(p.countrycode)?.toUpperCase()
		},
		tags
	};
}

export function factsFromNominatim(n: NominatimPlace): PlaceFacts | null {
	const type = n.osm_type ? (n.osm_type.toLowerCase() as OsmType) : undefined;
	if (!type || !(type in LETTER_BY_TYPE) || n.osm_id == null) return null;
	const a = n.address ?? {};
	const lat = Number(n.lat);
	const lon = Number(n.lon);
	return {
		osmType: type,
		osmId: String(n.osm_id),
		name: str(n.name) ?? null,
		key: str(n.category ?? n.class) ?? null,
		value: str(n.type) ?? null,
		lat: n.lat != null && Number.isFinite(lat) ? lat : null,
		lon: n.lon != null && Number.isFinite(lon) ? lon : null,
		address: {
			housenumber: str(a.house_number),
			street: str(a.road ?? a.pedestrian ?? a.footway),
			locality: str(a.neighbourhood ?? a.quarter),
			district: str(a.suburb ?? a.city_district ?? a.borough),
			city: str(a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality),
			county: str(a.county),
			state: str(a.state),
			postcode: str(a.postcode),
			country: str(a.country),
			countrycode: str(a.country_code)?.toUpperCase()
		},
		tags: Object.fromEntries(
			Object.entries(n.extratags ?? {}).filter(([, v]) => typeof v === 'string')
		)
	};
}

const defined = <T extends object>(o: T): Partial<T> =>
	Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '')) as Partial<T>;

/** Photon feature (what the user picked) + Nominatim lookup (extratags, fuller address). */
export function mergeFacts(photon: PlaceFacts | null, nom: PlaceFacts | null): PlaceFacts | null {
	if (!photon) return nom;
	if (!nom) return photon;
	return {
		...photon,
		name: photon.name ?? nom.name,
		key: photon.key ?? nom.key,
		value: photon.value ?? nom.value,
		lat: photon.lat ?? nom.lat,
		lon: photon.lon ?? nom.lon,
		address: { ...defined(nom.address), ...defined(photon.address) },
		tags: { ...photon.tags, ...nom.tags }
	};
}

export function mapPlaceHit(f: PlaceFacts): CatalogHit {
	return {
		source: 'osm',
		externalId: `${f.osmType}:${f.osmId}`,
		kind: placeKind(f.key, f.value),
		title: f.name ?? 'Unnamed place',
		subtitle: placeSubtitle(f),
		year: null,
		imageUrl: null
	};
}

/** Only http(s) links; bare domains ("example.com") get https://. */
export function safeUrl(v: string | undefined): string | null {
	const s = v?.trim().split(/\s*;\s*/)[0];
	if (!s) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
	try {
		const u = new URL(withScheme);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
	} catch {
		return null;
	}
}

export function mapPlaceDetails(f: PlaceFacts, now = Date.now()): ProviderEntry {
	const t = f.tags;
	const phone = str(t.phone ?? t['contact:phone'])?.split(/\s*;\s*/)[0] ?? null;
	const data: Record<string, unknown> = {
		lat: f.lat,
		lon: f.lon,
		osm_type: f.osmType,
		osm_id: f.osmId,
		osm_key: f.key,
		osm_value: f.value,
		type_label: typeLabel(f.key, f.value),
		cuisine: cuisineLabel(t.cuisine),
		address: defined(f.address),
		formatted_address: formatAddress(f.address),
		website: safeUrl(t.website ?? t['contact:website'] ?? t.url),
		phone,
		opening_hours: str(t.opening_hours) ?? null,
		osm_url: osmUrl(f.osmType, f.osmId)
	};
	if (t.wikipedia) data.wikipedia = t.wikipedia;
	return {
		source: 'osm',
		externalId: `${f.osmType}:${f.osmId}`,
		kind: placeKind(f.key, f.value),
		title: f.name ?? 'Unnamed place',
		subtitle: placeSubtitle(f),
		year: null,
		imageUrl: null,
		data,
		fetchedAt: now
	};
}

/**
 * Photon features -> hits: drops streets/houses/addresses unless nothing else matched, ranks points of
 * interest (and those matching the category preference) first, keeps Photon's order otherwise, and
 * removes duplicate OSM elements (Photon returns one feature per matching tag).
 */
export function rankPlaces(
	features: PlaceFacts[],
	prefer?: PlacePreference,
	limit = 8
): PlaceFacts[] {
	const scored = features.map((f, i) => {
		const tier = poiTier(f);
		const rank = tier === 2 ? 3 : prefer ? (matchesPreference(f, prefer) ? 0 : 1 + tier) : tier;
		return { f, rank, i };
	});
	const anyPlace = scored.some((s) => s.rank < 3);
	const out: PlaceFacts[] = [];
	const seen = new Set<string>();
	for (const s of scored
		.filter((s) => !anyPlace || s.rank < 3)
		.sort((a, b) => a.rank - b.rank || a.i - b.i)) {
		const id = `${s.f.osmType}:${s.f.osmId}`;
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(s.f);
		if (out.length >= limit) break;
	}
	return out;
}

// ---------- provider ----------

export interface PlacesOptions {
	photonUrl: string;
	/** null disables the Nominatim details lookup. */
	nominatimUrl: string | null;
	userAgent: string;
	contactEmail?: string | null;
	fetchImpl?: FetchLike;
	photonThrottle?: Throttle;
	nominatimThrottle?: Throttle;
	now?: () => number;
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

export function createPlacesProvider(opts: PlacesOptions): Provider {
	const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
	const now = opts.now ?? Date.now;
	// Public Photon: stay well under its fair-use limits (≤ 5 req/s from the whole instance).
	const photonThrottle = opts.photonThrottle ?? new Throttle(200, 2500);
	// Nominatim usage policy: an absolute maximum of 1 request per second.
	const nominatimThrottle = opts.nominatimThrottle ?? new Throttle(1100, 2500);
	// Features seen in recent searches, so details can be built without another upstream call.
	const seen = new LruCache<PlaceFacts>(3000, 6 * 60 * 60 * 1000, now);
	const photon = trimSlash(opts.photonUrl);
	const nominatim = opts.nominatimUrl ? trimSlash(opts.nominatimUrl) : null;
	const headers = { 'user-agent': opts.userAgent, accept: 'application/json' };

	async function getJson<T>(url: string, what: string, signal?: AbortSignal): Promise<T> {
		let res: Response;
		try {
			res = await fetchImpl(url, { headers, signal: signal ?? AbortSignal.timeout(8000) });
		} catch (e) {
			throw new ProviderError(`${what} request failed: ${(e as Error).message}`, 502);
		}
		if (res.status === 429) {
			const err = new ProviderError(`${what} rate limit hit`, 429);
			err.retryAfter = Number(res.headers.get('retry-after')) || null;
			throw err;
		}
		if (!res.ok) throw new ProviderError(`${what} responded ${res.status}`, 502);
		return (await res.json()) as T;
	}

	async function lookup(ref: ReturnType<typeof parseOsmId>): Promise<PlaceFacts | null> {
		if (!nominatim) return null;
		const params = new URLSearchParams({
			osm_ids: `${ref.letter}${ref.id}`,
			format: 'jsonv2',
			extratags: '1',
			addressdetails: '1',
			'accept-language': 'en'
		});
		if (opts.contactEmail) params.set('email', opts.contactEmail);
		const body = await nominatimThrottle.run(() =>
			getJson<NominatimPlace[]>(`${nominatim}/lookup?${params}`, 'Nominatim')
		);
		const first = Array.isArray(body) ? body[0] : undefined;
		return first ? factsFromNominatim(first) : null;
	}

	return {
		id: 'osm',
		kinds: [...PLACE_KINDS],
		attribution: { ...OSM_ATTRIBUTION },
		detailsTtlMs: PLACES_DETAILS_TTL_MS,
		async search(q: string, o: SearchOpts = {}) {
			const query = q.trim();
			if (!query) return [];
			const limit = o.limit ?? 8;
			const params = new URLSearchParams({
				q: query,
				// Over-fetch a little: streets and duplicate tags get filtered out below.
				limit: String(Math.min(20, limit + 4)),
				lang: 'en'
			});
			if (o.lat != null && o.lon != null) {
				params.set('lat', String(o.lat));
				params.set('lon', String(o.lon));
			}
			const fetchFeatures = (p: URLSearchParams) =>
				photonThrottle.run(() =>
					getJson<{ features?: PhotonFeature[] }>(`${photon}/api/?${p}`, 'Photon', o.signal)
				);
			const tags = (o.prefer && PREFER_TAGS[o.prefer]) || [];
			let body: { features?: PhotonFeature[] };
			if (tags.length) {
				const filtered = new URLSearchParams(params);
				for (const t of tags) filtered.append('osm_tag', t);
				body = await fetchFeatures(filtered);
				// Nothing tagged like food or drink: fall back to everything (one more call, still throttled).
				if (!body.features?.length) body = await fetchFeatures(params);
			} else body = await fetchFeatures(params);
			const facts = (body.features ?? []).map(factsFromPhoton).filter((f): f is PlaceFacts => !!f);
			let ranked = rankPlaces(facts, o.prefer, limit);
			if (o.kind && o.kind !== 'place') {
				const k = o.kind;
				ranked = ranked.filter((f) => placeKind(f.key, f.value) === k);
			}
			for (const f of ranked) seen.set(`${f.osmType}:${f.osmId}`, f);
			return ranked.map(mapPlaceHit);
		},
		async getDetails(externalId: string) {
			const ref = parseOsmId(externalId);
			const fromSearch = seen.get(ref.externalId) ?? null;
			let fromLookup: PlaceFacts | null = null;
			try {
				fromLookup = await lookup(ref);
			} catch (e) {
				// Optional enrichment: without it the entry is built from the search result alone.
				if (!fromSearch) {
					if (e instanceof ProviderError) throw e;
					throw new ProviderError('Place details are unavailable right now', 502);
				}
			}
			const facts = mergeFacts(fromSearch, fromLookup);
			if (!facts)
				throw nominatim
					? new ProviderError('Place not found', 404)
					: new ProviderError('Place details are unavailable, search for it again', 502);
			return mapPlaceDetails(facts, now());
		}
	};
}
