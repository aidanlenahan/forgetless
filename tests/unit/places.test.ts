import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	createPlacesProvider,
	parseOsmId,
	areaLabel,
	formatAddress,
	cuisineLabel,
	placeKind,
	safeUrl,
	PLACES_DETAILS_TTL_MS,
	type PhotonFeature
} from '../../src/lib/server/providers/places';
import { Throttle } from '../../src/lib/server/providers/throttle';
import {
	cachedSearch,
	normalizeSearchOpts,
	searchCacheKey,
	selectEntry,
	setProviders,
	placesUserAgent,
	DETAILS_TTL_MS
} from '../../src/lib/server/providers';
import { ProviderError, type Provider } from '../../src/lib/server/providers/types';
import {
	placePreference,
	tileGrid,
	tileXY,
	tileUrl,
	openingHoursLines,
	placeData
} from '../../src/lib/shared/places';
import { makeDb } from './helpers';

const jsonRes = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const feature = (
	props: NonNullable<PhotonFeature['properties']>,
	lonlat: [number, number] = [-73.987353, 40.7223431]
): PhotonFeature => ({
	type: 'Feature',
	properties: props,
	geometry: { type: 'Point', coordinates: lonlat }
});

// Shaped like real Photon responses (komoot, Nov 2026).
const katz = feature({
	osm_type: 'N',
	osm_id: 1915398676,
	osm_key: 'amenity',
	osm_value: 'restaurant',
	type: 'house',
	housenumber: '205',
	name: "Katz's Delicatessen",
	street: 'East Houston Street',
	locality: 'Manhattan Community Board 3',
	district: 'Manhattan',
	city: 'New York',
	state: 'New York',
	country: 'United States',
	postcode: '10002',
	countrycode: 'US'
});
const street = feature({
	osm_type: 'W',
	osm_id: 222,
	osm_key: 'highway',
	osm_value: 'residential',
	type: 'street',
	name: 'Katz Street',
	city: 'Springfield',
	state: 'Illinois',
	country: 'United States'
});
const house = feature({
	osm_type: 'N',
	osm_id: 333,
	osm_key: 'place',
	osm_value: 'house',
	type: 'house',
	housenumber: '1',
	street: 'Katz Lane',
	city: 'Springfield'
});
// Photon returns one feature per matching tag: same element as shop=deli and amenity=restaurant.
const katzingerShop = feature(
	{
		osm_type: 'W',
		osm_id: 160843547,
		osm_key: 'shop',
		osm_value: 'deli',
		type: 'house',
		name: "Katzinger's Delicatessen",
		locality: 'German Village',
		city: 'Columbus',
		state: 'Ohio',
		country: 'United States'
	},
	[-82.9963305, 39.952629]
);
const katzingerAmenity = feature(
	{
		...katzingerShop.properties,
		osm_key: 'amenity',
		osm_value: 'restaurant'
	},
	[-82.9963305, 39.952629]
);
const met = feature(
	{
		osm_type: 'R',
		osm_id: 3698894,
		osm_key: 'tourism',
		osm_value: 'museum',
		type: 'house',
		housenumber: '1000',
		name: 'The Metropolitan Museum of Art',
		street: '5th Avenue',
		locality: 'Upper East Side',
		district: 'Manhattan',
		city: 'New York',
		state: 'New York',
		country: 'United States'
	},
	[-73.9633825, 40.7794396]
);

const nominatimKatz = [
	{
		osm_type: 'node',
		osm_id: 1915398676,
		lat: '40.7223431',
		lon: '-73.9873530',
		category: 'amenity',
		type: 'restaurant',
		name: "Katz's Delicatessen",
		address: {
			amenity: "Katz's Delicatessen",
			house_number: '205',
			road: 'East Houston Street',
			neighbourhood: 'Manhattan Community Board 3',
			suburb: 'Manhattan',
			county: 'New York County',
			city: 'New York',
			state: 'New York',
			postcode: '10002',
			country: 'United States',
			country_code: 'us'
		},
		extratags: {
			phone: '+1-212-254-2246',
			cuisine: 'deli',
			website: 'https://www.katzsdelicatessen.com',
			opening_hours: 'Mo-Th 08:00-22:15; Fr 08:00-24:00'
		}
	}
];

/** A throttle that never waits (tests of mapping shouldn't sleep). */
const fast = () => new Throttle(0, 1000);

function provider(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, extra = {}) {
	return createPlacesProvider({
		photonUrl: 'https://photon.test/',
		nominatimUrl: 'https://nominatim.test',
		userAgent: 'Forgetless/test (+self-hosted; me@example.com)',
		contactEmail: 'me@example.com',
		fetchImpl,
		photonThrottle: fast(),
		nominatimThrottle: fast(),
		...extra
	});
}

describe('parseOsmId', () => {
	it('accepts long and short forms and normalises them', () => {
		expect(parseOsmId('node:123').externalId).toBe('node:123');
		expect(parseOsmId('way/456')).toMatchObject({ type: 'way', id: '456', letter: 'W' });
		expect(parseOsmId('R789').externalId).toBe('relation:789');
		expect(parseOsmId('n1').externalId).toBe('node:1');
	});
	it('rejects anything else', () => {
		for (const bad of ['', 'node:', 'area:1', 'node:12a', 'movie:550', 'X1'])
			expect(() => parseOsmId(bad)).toThrow(ProviderError);
	});
});

describe('labels', () => {
	it('maps OSM tags to place kinds', () => {
		expect(placeKind('amenity', 'restaurant')).toBe('restaurant');
		expect(placeKind('amenity', 'fast_food')).toBe('fast_food');
		expect(placeKind('amenity', 'cafe')).toBe('cafe');
		expect(placeKind('amenity', 'bar')).toBe('bar');
		expect(placeKind('amenity', 'pub')).toBe('pub');
		expect(placeKind('amenity', 'biergarten')).toBe('pub');
		expect(placeKind('tourism', 'museum')).toBe('place');
		expect(placeKind('leisure', 'park')).toBe('place');
		expect(placeKind('historic', 'castle')).toBe('place');
		expect(placeKind('natural', 'peak')).toBe('place');
		expect(placeKind('amenity', 'bank')).toBe('place');
	});
	it('composes area labels without junk localities', () => {
		expect(
			areaLabel({
				locality: 'Manhattan Community Board 3',
				district: 'Manhattan',
				city: 'New York'
			})
		).toBe('Manhattan, New York');
		expect(areaLabel({ locality: 'East Village', district: 'Manhattan', city: 'New York' })).toBe(
			'East Village, New York'
		);
		expect(areaLabel({ city: 'Kyoto', state: 'Kyoto Prefecture', country: 'Japan' })).toBe(
			'Kyoto, Kyoto Prefecture'
		);
		expect(areaLabel({ country: 'Iceland' })).toBe('Iceland');
		expect(areaLabel({})).toBeNull();
	});
	it('formats addresses and cuisines', () => {
		expect(
			formatAddress({
				housenumber: '205',
				street: 'East Houston Street',
				district: 'Manhattan',
				city: 'New York',
				postcode: '10002',
				country: 'United States'
			})
		).toBe('205 East Houston Street, Manhattan, New York 10002, United States');
		expect(formatAddress({ city: 'Paris', country: 'France' })).toBe('Paris, France');
		expect(cuisineLabel('ramen;japanese')).toBe('Ramen');
		expect(cuisineLabel('coffee_shop')).toBe('Coffee shop');
		expect(cuisineLabel('')).toBeNull();
	});
	it('only keeps http(s) website links', () => {
		expect(safeUrl('example.com')).toBe('https://example.com/');
		expect(safeUrl('http://a.test/x; https://b.test')).toBe('http://a.test/x');
		expect(safeUrl('javascript:alert(1)')).toBeNull();
		expect(safeUrl(undefined)).toBeNull();
	});
});

describe('places search (Photon)', () => {
	it('calls Photon with the query, language, limit and location bias, identifying itself', async () => {
		const fetchImpl = vi.fn(async () => jsonRes({ features: [katz] }));
		await provider(fetchImpl).search('katz', { lat: 40.72, lon: -73.99 });
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		const u = new URL(url);
		expect(u.origin + u.pathname).toBe('https://photon.test/api/');
		expect(u.searchParams.get('q')).toBe('katz');
		expect(u.searchParams.get('lang')).toBe('en');
		expect(Number(u.searchParams.get('limit'))).toBeGreaterThanOrEqual(8);
		expect(u.searchParams.get('lat')).toBe('40.72');
		expect(u.searchParams.get('lon')).toBe('-73.99');
		expect((init.headers as Record<string, string>)['user-agent']).toMatch(/^Forgetless\//);
	});

	it('maps POIs to hits and drops streets / houses / duplicate tags', async () => {
		const fetchImpl = vi.fn(async () =>
			jsonRes({ features: [street, katz, house, katzingerShop, katzingerAmenity] })
		);
		const hits = await provider(fetchImpl).search('katz');
		expect(hits).toEqual([
			{
				source: 'osm',
				externalId: 'node:1915398676',
				kind: 'restaurant',
				title: "Katz's Delicatessen",
				subtitle: 'Restaurant · Manhattan, New York',
				year: null,
				imageUrl: null
			},
			{
				source: 'osm',
				externalId: 'way:160843547',
				kind: 'place',
				title: "Katzinger's Delicatessen",
				subtitle: 'Deli · German Village, Columbus',
				year: null,
				imageUrl: null
			}
		]);
	});

	it('falls back to streets and addresses when nothing else matches', async () => {
		const fetchImpl = vi.fn(async () => jsonRes({ features: [street] }));
		const hits = await provider(fetchImpl).search('katz street');
		expect(hits.map((h) => h.externalId)).toEqual(['way:222']);
		expect(hits[0].subtitle).toBe('Residential · Springfield, Illinois');
	});

	it('ranks places matching the category preference first', async () => {
		const fetchImpl = vi.fn(async () => jsonRes({ features: [met, katz] }));
		const p = provider(fetchImpl);
		expect((await p.search('x', { prefer: 'eat' })).map((h) => h.title)).toEqual([
			"Katz's Delicatessen",
			'The Metropolitan Museum of Art'
		]);
		expect((await p.search('x', { prefer: 'visit' })).map((h) => h.title)).toEqual([
			'The Metropolitan Museum of Art',
			"Katz's Delicatessen"
		]);
		expect((await p.search('x')).map((h) => h.title)).toEqual([
			'The Metropolitan Museum of Art',
			"Katz's Delicatessen"
		]);
	});

	it('filters Eat / Drink searches to amenity, shop and craft tags, falling back when empty', async () => {
		const fetchImpl = vi.fn(async (url: string) =>
			jsonRes({ features: new URL(url).searchParams.has('osm_tag') ? [] : [met] })
		);
		const p = provider(fetchImpl);
		const hits = await p.search('met', { prefer: 'eat' });
		const urls = fetchImpl.mock.calls.map((c) => new URL(c[0] as string));
		expect(urls[0].searchParams.getAll('osm_tag')).toEqual(['amenity', 'shop', 'craft']);
		expect(urls[1].searchParams.has('osm_tag')).toBe(false);
		expect(hits.map((h) => h.externalId)).toEqual(['relation:3698894']);

		fetchImpl.mockClear();
		await p.search('met', { prefer: 'visit' });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(new URL(fetchImpl.mock.calls[0][0] as string).searchParams.has('osm_tag')).toBe(false);
	});

	it('turns upstream errors into ProviderErrors', async () => {
		const p429 = provider(async () => new Response('slow', { status: 429 }));
		await expect(p429.search('x')).rejects.toMatchObject({ status: 429 });
		const p500 = provider(async () => new Response('boom', { status: 500 }));
		await expect(p500.search('x')).rejects.toMatchObject({ status: 502 });
		const down = provider(async () => {
			throw new Error('ECONNREFUSED');
		});
		await expect(down.search('x')).rejects.toMatchObject({ status: 502 });
	});
});

describe('places details', () => {
	it('merges the Photon feature with Nominatim extratags', async () => {
		const fetchImpl = vi.fn(async (url: string) =>
			url.startsWith('https://photon.test') ? jsonRes({ features: [katz] }) : jsonRes(nominatimKatz)
		);
		const p = provider(fetchImpl);
		await p.search('katz');
		const d = await p.getDetails('node:1915398676');
		const nomUrl = new URL(fetchImpl.mock.calls[1][0] as string);
		expect(nomUrl.pathname).toBe('/lookup');
		expect(nomUrl.searchParams.get('osm_ids')).toBe('N1915398676');
		expect(nomUrl.searchParams.get('extratags')).toBe('1');
		expect(nomUrl.searchParams.get('format')).toBe('jsonv2');
		expect(nomUrl.searchParams.get('email')).toBe('me@example.com');
		expect(d).toMatchObject({
			source: 'osm',
			externalId: 'node:1915398676',
			kind: 'restaurant',
			title: "Katz's Delicatessen",
			subtitle: 'Deli · Manhattan, New York',
			year: null,
			imageUrl: null
		});
		expect(d.data).toMatchObject({
			lat: 40.7223431,
			lon: -73.987353,
			osm_key: 'amenity',
			osm_value: 'restaurant',
			cuisine: 'Deli',
			website: 'https://www.katzsdelicatessen.com/',
			phone: '+1-212-254-2246',
			opening_hours: 'Mo-Th 08:00-22:15; Fr 08:00-24:00',
			formatted_address: '205 East Houston Street, Manhattan, New York 10002, United States',
			osm_url: 'https://www.openstreetmap.org/node/1915398676'
		});
		expect((d.data.address as Record<string, string>).county).toBe('New York County');
	});

	it('builds details from the search result alone when Nominatim fails', async () => {
		for (const nomFail of [
			async () => new Response('nope', { status: 503 }),
			async () => {
				throw new Error('timeout');
			}
		]) {
			const p = provider((url) =>
				url.startsWith('https://photon.test')
					? Promise.resolve(jsonRes({ features: [met] }))
					: nomFail()
			);
			await p.search('met');
			const d = await p.getDetails('relation:3698894');
			expect(d.title).toBe('The Metropolitan Museum of Art');
			expect(d.subtitle).toBe('Museum · Upper East Side, New York');
			expect(d.data).toMatchObject({
				lat: 40.7794396,
				lon: -73.9633825,
				opening_hours: null,
				website: null,
				formatted_address: '1000 5th Avenue, Manhattan, New York, United States'
			});
		}
	});

	it('uses Nominatim alone for an id it has not seen, and errors when neither source has it', async () => {
		const p = provider(async () => jsonRes(nominatimKatz));
		expect((await p.getDetails('N1915398676')).data.cuisine).toBe('Deli');

		const empty = provider(async () => jsonRes([]));
		await expect(empty.getDetails('node:1')).rejects.toMatchObject({ status: 404 });

		const broken = provider(async () => new Response('x', { status: 500 }));
		await expect(broken.getDetails('node:1')).rejects.toMatchObject({ status: 502 });

		const noNominatim = provider(vi.fn(), { nominatimUrl: null });
		await expect(noNominatim.getDetails('node:1')).rejects.toMatchObject({ status: 502 });
	});

	it('skips Nominatim entirely when it is disabled', async () => {
		const fetchImpl = vi.fn(async () => jsonRes({ features: [katz] }));
		const p = provider(fetchImpl, { nominatimUrl: null });
		await p.search('katz');
		const d = await p.getDetails('node:1915398676');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(d.data.formatted_address).toBe(
			'205 East Houston Street, Manhattan, New York 10002, United States'
		);
	});
});

describe('Throttle', () => {
	it('spaces calls by the interval and turns callers away past maxWait', async () => {
		let t = 0;
		const waits: number[] = [];
		const th = new Throttle(
			1000,
			2500,
			() => t,
			async (ms) => {
				waits.push(ms);
			}
		);
		const ran: number[] = [];
		await th.run(async () => ran.push(1));
		await th.run(async () => ran.push(2));
		await th.run(async () => ran.push(3));
		expect(waits).toEqual([1000, 2000]);
		expect(th.waitMs()).toBe(3000);
		await expect(th.run(async () => ran.push(4))).rejects.toMatchObject({ status: 503 });
		expect(ran).toEqual([1, 2, 3]);
		t = 10_000; // time passes; slots free up again
		await th.run(async () => ran.push(5));
		expect(ran).toEqual([1, 2, 3, 5]);
	});

	it('really delays back-to-back Photon calls at the default rate', async () => {
		const at: number[] = [];
		const p = createPlacesProvider({
			photonUrl: 'https://photon.test',
			nominatimUrl: null,
			userAgent: 'test',
			fetchImpl: async () => {
				at.push(Date.now());
				return jsonRes({ features: [] });
			}
		});
		await Promise.all([p.search('a'), p.search('b'), p.search('c')]);
		expect(at[2] - at[0]).toBeGreaterThanOrEqual(380);
	});
});

describe('search cache with a location bias', () => {
	let calls: { q: string; lat?: number; lon?: number }[];
	let fake: Provider;
	beforeEach(() => {
		calls = [];
		fake = {
			id: 'osm',
			kinds: ['place'],
			attribution: { text: 'x', url: 'x' },
			async search(q, o = {}) {
				calls.push({ q, lat: o.lat, lon: o.lon });
				return [];
			},
			async getDetails() {
				throw new Error('unused');
			}
		};
		setProviders([fake]);
	});

	it('rounds coordinates to ~1 km before searching and caching', async () => {
		await cachedSearch(fake, 'Katz', { lat: 40.72231, lon: -73.98735 });
		await cachedSearch(fake, 'katz', { lat: 40.7249, lon: -73.9851 });
		expect(calls).toEqual([{ q: 'katz', lat: 40.72, lon: -73.99 }]);
		await cachedSearch(fake, 'katz', { lat: 40.78, lon: -73.96 });
		await cachedSearch(fake, 'katz');
		expect(calls).toHaveLength(3);
		expect(calls[2]).toEqual({ q: 'katz', lat: undefined, lon: undefined });
	});

	it('keys on provider, preference and rounded location', () => {
		const o = normalizeSearchOpts({ lat: 40.72231, lon: -73.98735, prefer: 'eat' });
		expect(searchCacheKey('osm', 'katz', o)).toBe('osm|||eat|40.72,-73.99|katz');
		expect(searchCacheKey('osm', 'katz', normalizeSearchOpts({}))).toBe('osm|||||katz');
	});

	it('drops half or invalid coordinates', () => {
		expect(normalizeSearchOpts({ lat: 40.7 })).toEqual({});
		expect(normalizeSearchOpts({ lat: 100, lon: 0 })).toEqual({});
		expect(normalizeSearchOpts({ lat: NaN, lon: 1 })).toEqual({});
	});
});

describe('selectEntry for places', () => {
	it('keeps cached place details for 30 days', async () => {
		const db = makeDb();
		const fetchImpl = vi.fn(async (url: string) =>
			url.startsWith('https://photon.test') ? jsonRes({ features: [katz] }) : jsonRes(nominatimKatz)
		);
		const p = provider(fetchImpl);
		expect(p.detailsTtlMs).toBe(PLACES_DETAILS_TTL_MS);
		expect(PLACES_DETAILS_TTL_MS).toBeGreaterThan(DETAILS_TTL_MS);
		const now = Date.now();
		const first = await selectEntry(p, 'node:1915398676', 'restaurant', db, now);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const again = await selectEntry(p, 'node:1915398676', 'restaurant', db, now + 20 * 86_400_000);
		expect(again.id).toBe(first.id);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		await selectEntry(p, 'node:1915398676', 'restaurant', db, now + 31 * 86_400_000);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});

describe('user agent', () => {
	it('identifies the app and points to a contact', () => {
		expect(placesUserAgent('1.2.3', '')).toBe(
			'Forgetless/1.2.3 (+self-hosted; set APP_CONTACT_EMAIL)'
		);
		expect(placesUserAgent('1.2.3', 'ops@example.org')).toBe(
			'Forgetless/1.2.3 (+self-hosted; ops@example.org)'
		);
	});
});

describe('shared place helpers', () => {
	it('guesses a ranking preference from the category', () => {
		expect(placePreference({ name: 'Eat', icon: '🍜' })).toBe('eat');
		expect(placePreference({ name: 'Drink', icon: '🍸' })).toBe('drink');
		expect(placePreference({ name: 'Coffee spots', icon: '⭐' })).toBe('drink');
		expect(placePreference({ name: 'Visit', icon: '📍' })).toBe('visit');
		expect(placePreference({ name: 'Barbecue', icon: '🔥' })).toBeNull();
		expect(placePreference(null)).toBeNull();
	});

	it('computes a tile grid centred on the point', () => {
		const p = { lat: 40.7223431, lon: -73.987353 };
		const t = tileXY(p, 16);
		expect(Math.floor(t.x)).toBe(19299);
		expect(Math.floor(t.y)).toBe(24637);
		const grid = tileGrid(p, 16);
		expect(grid).toHaveLength(9);
		const centre = grid[4];
		expect([centre.x, centre.y]).toEqual([19299, 24637]);
		// the point lies inside the centre tile: its top-left corner is 0..256 px up/left of the point
		expect(centre.left).toBeLessThanOrEqual(0);
		expect(centre.left).toBeGreaterThan(-256);
		expect(centre.top).toBeLessThanOrEqual(0);
		expect(centre.top).toBeGreaterThan(-256);
		expect(tileUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png', centre)).toBe(
			'https://tile.openstreetmap.org/16/19299/24637.png'
		);
	});

	it('splits opening hours and reads place data defensively', () => {
		expect(openingHoursLines('Mo-Th 08:00-22:15; Fr 08:00-24:00')).toEqual([
			'Mo-Th 08:00–22:15',
			'Fr 08:00–24:00'
		]);
		expect(openingHoursLines(null)).toEqual([]);
		expect(placeData({ lat: '1', lon: 2, website: 5 })).toMatchObject({
			lat: null,
			lon: 2,
			website: null
		});
	});
});
