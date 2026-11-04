// Demo / guest mode: sample data, guest flags, purge and the guest item cap.
// Account creation itself goes through Better Auth (see src/routes/api/demo/+server.ts).
import { UUID } from 'uuidv7';
import { getDb, type DB } from './db';
import { env } from './env';
import { applyMutations, upsertCatalogEntries } from './repo';
import { seedDefaultCategories } from './seed';
import { purgeExpiredGuestsSql } from './purge';
import { mapPlaceDetails, type PlaceFacts } from './providers/places';
import type { Item, LogEntry, Mutation, Status } from '../shared/types';

export function purgeExpiredGuests(db: DB = getDb(), now = Date.now()): number {
	return purgeExpiredGuestsSql(db.sqlite, now);
}

/** Flags a user as a guest that purgeExpiredGuests removes after `ttlMs` (sessions go with it via cascade). */
export function markGuest(
	userId: string,
	db: DB = getDb(),
	now = Date.now(),
	ttlMs = env.guestTtlMs
) {
	db.sqlite
		.prepare('UPDATE user SET is_guest = 1, guest_expires_at = ? WHERE id = ?')
		.run(now + ttlMs, userId);
}

export function isGuestUser(userId: string, db: DB = getDb()): boolean {
	const r = db.sqlite.prepare('SELECT is_guest FROM user WHERE id = ?').get(userId) as
		{ is_guest: number } | undefined;
	return !!r?.is_guest;
}

/**
 * How many non-deleted items the user would have after applying `mutations` — counting only items that
 * don't exist yet and aren't tombstones. Used to enforce env.guestItemCap.
 */
export function itemCountAfter(userId: string, mutations: Mutation[], db: DB = getDb()): number {
	const { n } = db.sqlite
		.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND deleted_at IS NULL')
		.get(userId) as { n: number };
	const exists = db.sqlite.prepare('SELECT 1 FROM items WHERE id = ?');
	const fresh = new Set<string>();
	for (const m of mutations) {
		if (m.kind !== 'item' || !m.row || typeof m.row.id !== 'string' || m.row.deletedAt) continue;
		if (!exists.get(m.row.id)) fresh.add(m.row.id);
	}
	return n + fresh.size;
}

// ---------- sample data ----------

const DAY = 24 * 60 * 60 * 1000;
const rnd = () => Math.floor(Math.random() * 0x100000000);
/** UUIDv7 whose timestamp matches `ts`, so ids sort like the (backdated) createdAt. */
const idAt = (ts: number) =>
	UUID.fromFieldsV7(ts, rnd() & 0xfff, rnd() & 0x3fffffff, rnd()).toString();
const isoDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Real TMDB metadata, hardcoded so the demo looks right without an API key. */
export const DEMO_CATALOG = [
	{
		externalId: 'tv:95396',
		kind: 'tv',
		title: 'Severance',
		year: 2022,
		poster: '/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg',
		data: {
			overview:
				'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives. When a mysterious colleague appears outside of work, it begins a journey to discover the truth about their jobs.',
			genres: ['Drama', 'Mystery', 'Sci-Fi & Fantasy'],
			original_title: 'Severance',
			seasons: 3,
			episodes: 19
		}
	},
	{
		externalId: 'movie:666277',
		kind: 'movie',
		title: 'Past Lives',
		year: 2023,
		poster: '/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg',
		data: {
			overview:
				'After decades apart, childhood friends Nora and Hae Sung are reunited in New York for one fateful weekend as they confront notions of destiny, love, and the choices that make a life.',
			genres: ['Drama', 'Romance'],
			original_title: 'Past Lives',
			runtime: 106
		}
	},
	{
		externalId: 'tv:136315',
		kind: 'tv',
		title: 'The Bear',
		year: 2022,
		poster: '/eKfVzzEazSIjJMrw9ADa2x8ksLz.jpg',
		data: {
			overview:
				'Carmy, a young fine-dining chef, comes home to Chicago to run his family sandwich shop. As he fights to transform the shop and himself, he works alongside a rough-around-the-edges crew that ultimately reveal themselves as his chosen family.',
			genres: ['Drama', 'Comedy'],
			original_title: 'The Bear',
			seasons: 5,
			episodes: 46
		}
	},
	{
		externalId: 'movie:329865',
		kind: 'movie',
		title: 'Arrival',
		year: 2016,
		poster: '/pEzNVQfdzYDzVK0XqxERIw2x2se.jpg',
		data: {
			overview:
				'Taking place after alien crafts land around the world, an expert linguist is recruited by the military to determine whether they come in peace or are a threat.',
			genres: ['Drama', 'Science Fiction', 'Mystery'],
			original_title: 'Arrival',
			runtime: 116
		}
	},
	{
		externalId: 'movie:693134',
		kind: 'movie',
		title: 'Dune: Part Two',
		year: 2024,
		poster: '/6izwz7rsy95ARzTR3poZ8H6c5pp.jpg',
		data: {
			overview:
				'Follow the mythic journey of Paul Atreides as he unites with Chani and the Fremen while on a path of revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the known universe, Paul endeavors to prevent a terrible future only he can foresee.',
			genres: ['Science Fiction', 'Adventure'],
			original_title: 'Dune: Part Two',
			runtime: 167
		}
	},
	{
		externalId: 'tv:126308',
		kind: 'tv',
		title: 'Shōgun',
		year: 2024,
		poster: '/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg',
		data: {
			overview:
				'In Japan in the year 1600, at the dawn of a century-defining civil war, Lord Yoshii Toranaga is fighting for his life as his enemies on the Council of Regents unite against him, when a mysterious European ship is found marooned in a nearby fishing village.',
			genres: ['Drama', 'War & Politics'],
			original_title: 'Shōgun',
			seasons: 1,
			episodes: 10
		}
	}
] as const;

interface DemoLog {
	daysAgo: number;
	rating?: number; // 1-10
	note?: string;
}
interface DemoItem {
	cat: 'Watch' | 'Read' | 'Eat' | 'Visit' | 'Drink' | 'Cook';
	title: string;
	daysAgo: number;
	status?: Status;
	by?: string;
	source?: string;
	why?: string;
	tags?: string[];
	fields?: Record<string, unknown>;
	tmdb?: string; // externalId in DEMO_CATALOG
	place?: string; // externalId in DEMO_PLACES
	logs?: DemoLog[];
}

/**
 * Real OpenStreetMap elements (ids, coordinates and tags checked against Photon / Nominatim in Nov 2026),
 * hardcoded so the demo's places have an address and a map without calling the public servers.
 */
export const DEMO_PLACES: PlaceFacts[] = [
	{
		osmType: 'node',
		osmId: '4196029141',
		name: 'Lucali',
		key: 'amenity',
		value: 'restaurant',
		lat: 40.6818319,
		lon: -74.0003712,
		address: {
			housenumber: '575',
			street: 'Henry Street',
			locality: 'Columbia Street Waterfront District',
			district: 'Brooklyn',
			city: 'New York',
			state: 'New York',
			country: 'United States',
			countrycode: 'US'
		},
		tags: {}
	},
	{
		osmType: 'node',
		osmId: '1915398676',
		name: 'Katz’s Delicatessen',
		key: 'amenity',
		value: 'restaurant',
		lat: 40.7223431,
		lon: -73.987353,
		address: {
			housenumber: '205',
			street: 'East Houston Street',
			locality: 'Manhattan Community Board 3',
			district: 'Manhattan',
			city: 'New York',
			state: 'New York',
			postcode: '10002',
			country: 'United States',
			countrycode: 'US'
		},
		tags: {
			cuisine: 'deli',
			website: 'https://www.katzsdelicatessen.com',
			phone: '+1-212-254-2246',
			opening_hours: 'Mo-Th 08:00-22:15; Fr 08:00-24:00; Sa 00:00-24:00; Su 00:00-22:15'
		}
	},
	{
		osmType: 'way',
		osmId: '833335529',
		name: 'Little Island',
		key: 'leisure',
		value: 'park',
		lat: 40.7420041,
		lon: -74.0106105,
		address: {
			district: 'Manhattan',
			city: 'New York',
			state: 'New York',
			country: 'United States',
			countrycode: 'US'
		},
		tags: {}
	},
	{
		osmType: 'relation',
		osmId: '3698894',
		name: 'The Metropolitan Museum of Art',
		key: 'tourism',
		value: 'museum',
		lat: 40.7794396,
		lon: -73.9633825,
		address: {
			housenumber: '1000',
			street: '5th Avenue',
			locality: 'Upper East Side',
			district: 'Manhattan',
			city: 'New York',
			state: 'New York',
			country: 'United States',
			countrycode: 'US'
		},
		tags: {}
	}
];

export const DEMO_ITEMS: DemoItem[] = [
	{
		cat: 'Watch',
		title: 'Severance',
		tmdb: 'tv:95396',
		daysAgo: 230,
		status: 'done',
		by: 'Sam',
		source: 'Group chat',
		why: 'Sam would not stop talking about the elevator scenes.',
		tags: ['sci-fi', 'binge'],
		logs: [
			{ daysAgo: 200, rating: 9, note: 'Season 1 finale!!' },
			{ daysAgo: 40, rating: 10, note: 'Rewatched before season 2. Even better.' }
		]
	},
	{
		cat: 'Watch',
		title: 'Past Lives',
		tmdb: 'movie:666277',
		daysAgo: 180,
		status: 'done',
		by: 'Priya',
		why: 'Bring tissues, apparently.',
		tags: ['date night'],
		logs: [{ daysAgo: 150, rating: 9, note: 'Quietly devastating.' }]
	},
	{
		cat: 'Watch',
		title: 'The Bear',
		tmdb: 'tv:136315',
		daysAgo: 120,
		status: 'in_progress',
		by: 'Mom',
		why: 'Mom says it stresses her out in a good way.',
		tags: ['comedy', 'food'],
		logs: [{ daysAgo: 60, rating: 8, note: 'Finished S1. "Yes, chef."' }]
	},
	{
		cat: 'Watch',
		title: 'Arrival',
		tmdb: 'movie:329865',
		daysAgo: 210,
		status: 'want',
		by: 'Sam',
		source: 'Blank Check podcast',
		tags: ['sci-fi']
	},
	{
		cat: 'Watch',
		title: 'Dune: Part Two',
		tmdb: 'movie:693134',
		daysAgo: 95,
		status: 'want',
		by: 'Priya',
		why: 'See it on the biggest screen possible.',
		tags: ['sci-fi', 'imax']
	},
	{
		cat: 'Watch',
		title: 'Shōgun',
		tmdb: 'tv:126308',
		daysAgo: 25,
		status: 'want',
		source: 'The Rewatchables podcast',
		tags: ['drama']
	},
	{
		cat: 'Read',
		title: 'Project Hail Mary',
		daysAgo: 240,
		status: 'done',
		by: 'Sam',
		fields: { author: 'Andy Weir' },
		tags: ['sci-fi'],
		logs: [{ daysAgo: 190, rating: 10, note: 'Rocky is the best character ever written.' }]
	},
	{
		cat: 'Read',
		title: 'Tomorrow, and Tomorrow, and Tomorrow',
		daysAgo: 160,
		status: 'in_progress',
		by: 'Priya',
		fields: { author: 'Gabrielle Zevin' },
		why: 'About friends who make video games.',
		tags: ['fiction']
	},
	{
		cat: 'Read',
		title: 'The Anthropocene Reviewed',
		daysAgo: 70,
		status: 'want',
		source: 'Heard on a podcast',
		fields: { author: 'John Green' },
		tags: ['essays']
	},
	{
		cat: 'Read',
		title: 'Piranesi',
		daysAgo: 12,
		status: 'want',
		by: 'Mom',
		fields: { author: 'Susanna Clarke' },
		tags: ['fantasy', 'short']
	},
	{
		cat: 'Eat',
		title: 'Lucali',
		place: 'node:4196029141',
		daysAgo: 200,
		status: 'done',
		by: 'Priya',
		fields: { neighborhood: 'Carroll Gardens', price: '$$' },
		why: 'Best pizza in Brooklyn, get there at 5pm.',
		tags: ['pizza'],
		logs: [
			{ daysAgo: 170, rating: 9, note: 'Waited 2 hours. Worth it.' },
			{ daysAgo: 30, rating: 8, note: 'Took Mom for her birthday.' }
		]
	},
	{
		cat: 'Eat',
		title: 'Xi’an Famous Foods',
		daysAgo: 140,
		status: 'done',
		by: 'Sam',
		fields: { neighborhood: 'Chinatown', price: '$' },
		tags: ['noodles', 'cheap eats'],
		logs: [{ daysAgo: 135, rating: 8, note: 'Spicy cumin lamb noodles. Yes.' }]
	},
	{
		cat: 'Eat',
		title: 'Dhamaka',
		daysAgo: 45,
		status: 'want',
		by: 'Priya',
		fields: { neighborhood: 'Lower East Side', price: '$$$' },
		why: 'Order the goat neck.',
		tags: ['indian']
	},
	{
		cat: 'Eat',
		title: 'Thai Diner',
		daysAgo: 8,
		status: 'want',
		source: 'Saw it on a walk',
		fields: { neighborhood: 'Nolita', price: '$$' },
		tags: ['thai', 'brunch']
	},
	{
		cat: 'Visit',
		title: 'Storm King Art Center',
		daysAgo: 220,
		status: 'done',
		by: 'Mom',
		fields: { location: 'New Windsor, NY' },
		tags: ['day trip', 'outdoors'],
		logs: [{ daysAgo: 160, rating: 9, note: 'Go in October for the leaves.' }]
	},
	{
		cat: 'Visit',
		title: 'Little Island',
		place: 'way:833335529',
		daysAgo: 100,
		status: 'want',
		by: 'Sam',
		fields: { location: 'Hudson River Park' },
		tags: ['outdoors']
	},
	{
		cat: 'Eat',
		title: 'Katz’s Delicatessen',
		place: 'node:1915398676',
		daysAgo: 20,
		status: 'want',
		by: 'Sam',
		why: 'Pastrami on rye. Keep your ticket.',
		fields: { neighborhood: 'Lower East Side', price: '$$' },
		tags: ['deli', 'classic']
	},
	{
		cat: 'Visit',
		title: 'The Met',
		place: 'relation:3698894',
		daysAgo: 70,
		status: 'want',
		by: 'Mom',
		why: 'The rooftop garden in summer, then the Temple of Dendur.',
		fields: { location: 'Upper East Side' },
		tags: ['museum', 'rainy day']
	},
	{
		cat: 'Visit',
		title: 'Kyoto',
		daysAgo: 55,
		status: 'want',
		by: 'Priya',
		fields: { location: 'Japan' },
		why: 'Fushimi Inari at sunrise before the crowds.',
		tags: ['travel']
	},
	{
		cat: 'Drink',
		title: 'Death & Co',
		daysAgo: 130,
		status: 'done',
		by: 'Sam',
		why: 'Classic cocktail bar.',
		tags: ['cocktails'],
		logs: [{ daysAgo: 90, rating: 7 }]
	},
	{
		cat: 'Drink',
		title: 'Hazy IPA from Other Half',
		daysAgo: 35,
		status: 'want',
		source: 'Brewery Instagram',
		tags: ['beer']
	},
	{
		cat: 'Cook',
		title: 'Marcella Hazan’s tomato sauce',
		daysAgo: 190,
		status: 'done',
		by: 'Mom',
		fields: {
			recipe_url: 'https://cooking.nytimes.com/recipes/1015178-marcella-hazans-tomato-sauce'
		},
		why: 'Three ingredients. Butter + onion.',
		tags: ['pasta', 'easy'],
		logs: [
			{ daysAgo: 185, rating: 10 },
			{ daysAgo: 100, rating: 9, note: 'Doubled it and froze half.' },
			{ daysAgo: 20, rating: 10 }
		]
	},
	{
		cat: 'Cook',
		title: 'Crispy smashed potatoes',
		daysAgo: 15,
		status: 'want',
		source: 'Serious Eats',
		tags: ['side', 'easy']
	},
	{
		cat: 'Cook',
		title: 'Sourdough starter',
		daysAgo: 250,
		status: 'dropped',
		by: 'Priya',
		why: 'Too much commitment for now.',
		tags: ['baking']
	}
];

/** Seeds sample categories/items/log entries/catalog entries for a (guest) user. */
export function seedDemoData(userId: string, db: DB = getDb(), now = Date.now()) {
	seedDefaultCategories(userId, db);
	const cats = db.sqlite
		.prepare('SELECT id, name FROM categories WHERE user_id = ? AND deleted_at IS NULL')
		.all(userId) as { id: string; name: string }[];
	const catId = new Map(cats.map((c) => [c.name, c.id]));

	const catalog = upsertCatalogEntries(
		DEMO_CATALOG.map((c) => ({
			source: 'tmdb',
			externalId: c.externalId,
			kind: c.kind,
			title: c.title,
			subtitle: `${c.kind === 'movie' ? 'Movie' : 'TV'} · ${c.year}`,
			year: c.year,
			imageUrl: `https://image.tmdb.org/t/p/w342${c.poster}`,
			data: {
				...c.data,
				tmdb_url: `https://www.themoviedb.org/${c.kind}/${c.externalId.split(':')[1]}`
			},
			fetchedAt: now
		})),
		db
	);
	const catalogId = new Map(catalog.map((c) => [c.externalId, c.id]));
	const places = upsertCatalogEntries(
		DEMO_PLACES.map((f) => mapPlaceDetails(f, now)),
		db
	);
	const placeId = new Map(places.map((c) => [c.externalId, c.id]));

	const mutations: Mutation[] = [];
	for (const d of DEMO_ITEMS) {
		const categoryId = catId.get(d.cat);
		if (!categoryId) continue;
		const createdAt = now - d.daysAgo * DAY - Math.floor(Math.random() * 6 * 60 * 60 * 1000);
		const lastLog = d.logs?.length ? Math.min(...d.logs.map((l) => l.daysAgo)) : null;
		const updatedAt = lastLog != null ? now - lastLog * DAY : createdAt;
		const item: Item = {
			id: idAt(createdAt),
			categoryId,
			catalogEntryId: d.tmdb
				? (catalogId.get(d.tmdb) ?? null)
				: d.place
					? (placeId.get(d.place) ?? null)
					: null,
			title: d.title,
			status: d.status ?? 'want',
			recommendedBy: d.by ?? null,
			source: d.source ?? null,
			why: d.why ?? null,
			tags: d.tags ?? [],
			customFields: d.fields ?? {},
			needsMatch: false,
			createdAt,
			updatedAt,
			deletedAt: null
		};
		mutations.push({ kind: 'item', row: item });
		for (const l of d.logs ?? []) {
			const ts = now - l.daysAgo * DAY;
			const log: LogEntry = {
				id: idAt(ts),
				itemId: item.id,
				date: isoDate(ts),
				rating: l.rating ?? null,
				note: l.note ?? null,
				createdAt: ts,
				updatedAt: ts,
				deletedAt: null
			};
			mutations.push({ kind: 'logEntry', row: log });
		}
	}
	return applyMutations(userId, mutations, db);
}
