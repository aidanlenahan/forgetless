import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { expandUploads, parseAppImport } from '../../src/lib/server/imports/detect';
import {
	goodreadsRating,
	imdbRating,
	isoDate,
	letterboxdRating,
	normTitle
} from '../../src/lib/server/imports/util';
import { imdbKind } from '../../src/lib/server/imports/imdb';
import { bestHit, matchRecord, withRetry } from '../../src/lib/server/imports/match';
import { buildPreview, startAppImport } from '../../src/lib/server/imports/jobs';
import { createTmdbProvider } from '../../src/lib/server/providers/tmdb';
import { ProviderError, type Provider } from '../../src/lib/server/providers/types';
import { setProviders } from '../../src/lib/server/providers';
import { applyMutations, pull } from '../../src/lib/server/repo';
import type { DB } from '../../src/lib/server/db';
import type { CatalogHit } from '../../src/lib/shared/types';
import { makeDb, addUser, cat, item } from './helpers';

const FIX = fileURLToPath(new URL('../fixtures/', import.meta.url));
const file = (rel: string) => ({
	name: rel.split('/').pop()!,
	text: readFileSync(FIX + rel, 'utf8')
});
const dir = (d: string) => readdirSync(FIX + d).map((f) => file(`${d}/${f}`));

describe('rating conversions', () => {
	it('maps each app scale onto 1–10', () => {
		expect([0.5, 1, 2.5, 4.5, 5].map((n) => letterboxdRating(String(n)))).toEqual([1, 2, 5, 9, 10]);
		expect(letterboxdRating('')).toBeNull();
		expect([1, 7, 10, 11].map((n) => imdbRating(String(n)))).toEqual([1, 7, 10, 10]);
		expect(imdbRating('')).toBeNull();
		expect([1, 3, 5].map((n) => goodreadsRating(String(n)))).toEqual([2, 6, 10]);
		expect(goodreadsRating('0')).toBeNull(); // Goodreads: 0 = not rated
	});

	it('normalises dates and titles', () => {
		expect(isoDate('2023/2/4')).toBe('2023-02-04');
		expect(isoDate('2023-02-14T10:00:00Z')).toBe('2023-02-14');
		expect(isoDate('soon')).toBeNull();
		expect(normTitle('Amélie')).toBe(normTitle('amelie'));
		expect(normTitle('Crouching Tiger, Hidden Dragon')).toBe('crouching tiger hidden dragon');
		expect(normTitle('Fast & Furious')).toBe(normTitle('Fast and Furious'));
	});
});

describe('Letterboxd', () => {
	const parsed = parseAppImport(dir('letterboxd'));
	const by = (title: string, year?: number) =>
		parsed.records.find((r) => r.title === title && (year == null || r.year === year))!;

	it('detects the export and dedupes films across files by name + year', () => {
		expect(parsed.source).toBe('letterboxd');
		expect(parsed.records.map((r) => `${r.title} (${r.year})`).sort()).toEqual([
			'Amélie (2001)',
			'Arrival (2016)',
			'Crouching Tiger, Hidden Dragon (2000)',
			'Perfect Days (2023)',
			'The Thing (1982)',
			'The Thing (2011)'
		]);
	});

	it('maps watchlist → want and watched/diary → done, keeps the film URI as source', () => {
		expect(by('Perfect Days').status).toBe('want');
		expect(by('Crouching Tiger, Hidden Dragon').status).toBe('want');
		const arrival = by('Arrival');
		expect(arrival.status).toBe('done');
		expect(arrival.source).toBe('https://boxd.it/test2');
		expect(arrival.tags).toEqual(['sci-fi', 'cinema']);
		expect(arrival.kind).toBe('movie');
		expect(arrival.addedAt).toBe(Date.parse('2023-06-01T12:00:00Z'));
	});

	it('turns diary rows into log entries and attaches reviews to the same-day entry', () => {
		expect(by('Arrival').logs).toEqual([
			{ date: '2023-06-01', rating: 9, note: null },
			{
				date: '2024-05-09',
				rating: 10,
				note: 'Rewatch\nEven better the second time.\nThe "heptapods" scene\nstill gets me.'
			}
		]);
		expect(by('The Thing', 1982).logs).toEqual([{ date: '2023-07-15', rating: 8, note: null }]);
	});

	it('uses ratings.csv only for films without a diary entry', () => {
		expect(by('The Thing', 2011).logs).toEqual([{ date: '2023-07-16', rating: 5, note: null }]);
		expect(by('Amélie').logs).toEqual([{ date: '2023-08-02', rating: 1, note: null }]);
		expect(by('Arrival').logs).toHaveLength(2); // ratings.csv row ignored: diary has it
	});

	it('reads the export ZIP and ignores likes/ and lists/', () => {
		const zip = zipSync({
			'letterboxd-user-2026/watchlist.csv': strToU8(file('letterboxd/watchlist.csv').text),
			'letterboxd-user-2026/watched.csv': strToU8(file('letterboxd/watched.csv').text),
			'letterboxd-user-2026/likes/films.csv': strToU8(file('letterboxd/watched.csv').text),
			'letterboxd-user-2026/lists/faves.csv': strToU8('Date,Name\n'),
			'letterboxd-user-2026/profile.csv': strToU8('Username,Given Name\nx,y\n')
		});
		const files = expandUploads([{ name: 'export.zip', data: zip }]);
		expect(files.map((f) => f.name).sort()).toEqual([
			'profile.csv',
			'watched.csv',
			'watchlist.csv'
		]);
		const p = parseAppImport(files);
		expect(p.source).toBe('letterboxd');
		expect(p.records).toHaveLength(6);
		expect(p.warnings).toEqual([]);
	});
});

describe('IMDb', () => {
	const parsed = parseAppImport(dir('imdb'));
	const by = (id: string) => parsed.records.find((r) => r.imdbId === id)!;

	it('maps title types', () => {
		expect(['Movie', 'movie', 'tvMovie', 'Short'].map(imdbKind)).toEqual([
			'movie',
			'movie',
			'movie',
			'movie'
		]);
		expect(['TV Series', 'tvSeries', 'tvMiniSeries', 'TV Mini Series'].map(imdbKind)).toEqual([
			'tv',
			'tv',
			'tv',
			'tv'
		]);
		expect(['TV Episode', 'videoGame'].map(imdbKind)).toEqual(['other', 'other']);
	});

	it('merges ratings and lists by IMDb id', () => {
		expect(parsed.source).toBe('imdb');
		expect(parsed.records).toHaveLength(5);
		const shawshank = by('tt0111161');
		expect(shawshank.status).toBe('done');
		expect(shawshank.logs).toEqual([{ date: '2023-04-01', rating: 9, note: null }]); // not duplicated
		expect(shawshank.addedAt).toBe(Date.parse('2023-01-10T12:00:00Z'));
		expect(by('tt0903747')).toMatchObject({ kind: 'tv', status: 'done' });
		expect(by('tt2301451').kind).toBe('other');
		expect(by('tt15239678')).toMatchObject({
			kind: 'movie',
			status: 'want',
			why: 'Sam says see it in IMAX',
			source: 'https://www.imdb.com/title/tt15239678/',
			customFields: { imdb_id: 'tt15239678' },
			logs: []
		});
	});

	it('rejects a source mismatch', () => {
		expect(() => parseAppImport(dir('imdb'), 'letterboxd')).toThrow(/IMDb files, not Letterboxd/);
	});
});

describe('Goodreads', () => {
	const parsed = parseAppImport([file('goodreads_library_export.csv')]);
	const by = (t: string) => parsed.records.find((r) => r.title.startsWith(t))!;

	it('maps shelves, ratings, ISBNs (="..."), authors and reviews', () => {
		expect(parsed.source).toBe('goodreads');
		expect(parsed.records).toHaveLength(4);
		expect(by('Piranesi')).toMatchObject({
			kind: 'book',
			status: 'done',
			year: 2020,
			source: 'https://www.goodreads.com/book/show/100001',
			customFields: { author: 'Susanna Clarke', isbn: '9781635575637' },
			tags: ['fantasy', 'favorites'],
			logs: [
				{
					date: '2023-02-14',
					rating: 10,
					note: 'Strange and lovely.\n\nThe House is beautiful.'
				}
			]
		});
		expect(by('The Left Hand')).toMatchObject({
			status: 'want',
			year: 1969,
			tags: ['sci-fi'],
			why: 'From the book club list',
			logs: []
		});
		expect(by('Tomorrow')).toMatchObject({
			status: 'in_progress',
			customFields: { author: 'Gabrielle Zevin' }
		});
		expect(by('Infinite Jest')).toMatchObject({
			status: 'dropped',
			tags: [],
			logs: [{ date: '2022-03-03', rating: 4, note: null }]
		});
	});

	it('rejects unknown files', () => {
		expect(() => parseAppImport([{ name: 'x.csv', text: 'a,b\n1,2\n' }])).toThrow(/recognise/);
	});
});

// ---------- matching ----------

const jsonRes = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('TMDB findByExternalId (IMDb ids)', () => {
	it('calls /find with external_source=imdb_id and maps movie and TV results', async () => {
		const urls: string[] = [];
		const fetchMock = vi.fn(async (u: string) => {
			urls.push(u);
			return jsonRes({
				movie_results: [],
				tv_results: [
					{ id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', poster_path: '/bb.jpg' }
				]
			});
		});
		const p = createTmdbProvider('k', fetchMock);
		const hits = await p.findByExternalId!('imdb', 'tt0903747');
		expect(new URL(urls[0]).pathname).toBe('/3/find/tt0903747');
		expect(new URL(urls[0]).searchParams.get('external_source')).toBe('imdb_id');
		expect(hits).toEqual([
			{
				source: 'tmdb',
				externalId: 'tv:1396',
				kind: 'tv',
				title: 'Breaking Bad',
				subtitle: 'TV · 2008',
				year: 2008,
				imageUrl: 'https://image.tmdb.org/t/p/w185/bb.jpg'
			}
		]);
		expect(await p.findByExternalId!('imdb', 'not-an-id')).toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('reports 429 as a retryable error', async () => {
		const p = createTmdbProvider(
			'k',
			async () => new Response('{}', { status: 429, headers: { 'retry-after': '2' } })
		);
		await expect(p.search('x')).rejects.toMatchObject({ status: 429, retryAfter: 2 });
	});
});

describe('matching helpers', () => {
	const hit = (title: string, year: number | null, id = title): CatalogHit => ({
		source: 'tmdb',
		externalId: `movie:${id}`,
		kind: 'movie',
		title,
		subtitle: null,
		year,
		imageUrl: null
	});

	it('picks an equal normalised title with year within ±1, closest first', () => {
		const hits = [
			hit('Thing', 1982, '1'),
			hit('The Thing', 2011, '2'),
			hit('The Thing', 1982, '3')
		];
		expect(bestHit(hits, 'The Thing', 1982)?.externalId).toBe('movie:3');
		expect(bestHit(hits, 'The thing', 2012)?.externalId).toBe('movie:2');
		expect(bestHit(hits, 'The Thing', 1990)).toBeNull();
		expect(bestHit([hit('Amelie', 2001)], 'Amélie', 2001)).not.toBeNull();
	});

	it('retries 429s with backoff, then gives up', async () => {
		const sleep = vi.fn(async () => {});
		let n = 0;
		const ok = await withRetry(
			async () => {
				if (n++ < 2) throw new ProviderError('slow down', 429);
				return 'ok';
			},
			{ sleep }
		);
		expect(ok).toBe('ok');
		expect(sleep).toHaveBeenCalledTimes(2);
		await expect(
			withRetry(
				async () => {
					throw new ProviderError('slow down', 429);
				},
				{ sleep, maxRetries: 1 }
			)
		).rejects.toMatchObject({ status: 429 });
	});
});

/** In-memory TMDB stand-in: a few films and shows, by title and IMDb id. */
function mockTmdb(): Provider & { calls: string[] } {
	const db: (CatalogHit & { imdb?: string })[] = [
		{ ...base('movie:329865', 'movie', 'Arrival', 2016), imdb: 'tt2543164' },
		{ ...base('movie:1091', 'movie', 'The Thing', 1982) },
		{ ...base('movie:60935', 'movie', 'The Thing', 2011) },
		{ ...base('movie:194', 'movie', 'Amélie', 2001) },
		{ ...base('movie:278', 'movie', 'The Shawshank Redemption', 1994), imdb: 'tt0111161' },
		{ ...base('tv:1396', 'tv', 'Breaking Bad', 2008), imdb: 'tt0903747' },
		{ ...base('movie:693134', 'movie', 'Dune: Part Two', 2024), imdb: 'tt15239678' }
	];
	function base(externalId: string, kind: string, title: string, year: number): CatalogHit {
		return { source: 'tmdb', externalId, kind, title, subtitle: null, year, imageUrl: null };
	}
	const calls: string[] = [];
	return {
		id: 'tmdb',
		kinds: ['movie', 'tv'],
		attribution: { text: 'mock', url: 'https://example.test' },
		calls,
		async search(q, opts = {}) {
			calls.push(`search:${q}:${opts.year ?? ''}`);
			return db
				.filter((h) => h.title.toLowerCase().includes(q.toLowerCase()))
				.filter((h) => !opts.kind || h.kind === opts.kind)
				.filter((h) => !opts.year || h.year === opts.year)
				.map(({ imdb: _i, ...h }) => h);
		},
		async getDetails(externalId) {
			calls.push(`details:${externalId}`);
			const h = db.find((x) => x.externalId === externalId);
			if (!h) throw new ProviderError('Not found', 404);
			return { ...h, imdb: undefined, data: { overview: 'mock' }, fetchedAt: Date.now() };
		},
		async findByExternalId(_s, id) {
			calls.push(`find:${id}`);
			return db.filter((h) => h.imdb === id).map(({ imdb: _i, ...h }) => h);
		}
	};
}

describe('import jobs', () => {
	let db: DB;
	let u: string;
	beforeEach(() => {
		db = makeDb();
		u = addUser(db);
		setProviders(null); // clears the shared search cache
	});

	it('matches by IMDb id via /find and falls back to custom needsMatch items', async () => {
		const tmdb = mockTmdb();
		const parsed = parseAppImport(dir('imdb'));
		const shawshank = parsed.records.find((r) => r.imdbId === 'tt0111161')!;
		const entry = await matchRecord(shawshank, { db, provider: tmdb });
		expect(entry).toMatchObject({
			source: 'tmdb',
			externalId: 'movie:278',
			title: 'The Shawshank Redemption'
		});
		expect(tmdb.calls).toEqual(['find:tt0111161', 'details:movie:278']);
		// cached through catalog_entries: no second details call
		await matchRecord(shawshank, { db, provider: tmdb });
		expect(tmdb.calls.filter((c) => c.startsWith('details'))).toHaveLength(1);
		const witcher = parsed.records.find((r) => r.imdbId === 'tt5180504')!;
		expect(await matchRecord(witcher, { db, provider: tmdb })).toBeNull();
	});

	it('imports Letterboxd end-to-end: matches, logs, skips duplicates, reports progress', async () => {
		const watch = cat({ name: 'Watch', provider: 'tmdb' });
		const existing = item(watch.id, { title: 'Perfect Days', status: 'want' });
		applyMutations(
			u,
			[
				{ kind: 'category', row: watch },
				{ kind: 'item', row: existing }
			],
			db
		);
		const parsed = parseAppImport(dir('letterboxd'));

		const preview = buildPreview(u, parsed, { db, matching: true });
		expect(preview).toMatchObject({
			source: 'letterboxd',
			categoryId: watch.id,
			duplicates: 1,
			duplicateTitles: ['Perfect Days'],
			counts: {
				items: 6,
				logEntries: 5,
				byStatus: { want: 2, done: 4, in_progress: 0, dropped: 0 }
			},
			matching: true
		});

		const { job, done } = startAppImport({
			userId: u,
			parsed,
			categoryId: watch.id,
			provider: mockTmdb(),
			db
		});
		expect(job.status).toBe('running');
		await done;
		const { getJob } = await import('../../src/lib/server/imports/jobs');
		expect(getJob(job.id, u)).toMatchObject({
			status: 'done',
			total: 6,
			done: 6,
			created: 5,
			matched: 4, // Arrival, both Things, Amélie
			unmatched: 1, // Crouching Tiger isn't in the mock
			skippedDuplicates: 1,
			logEntries: 5
		});
		expect(getJob(job.id, 'someone-else')).toBeNull();

		const snap = pull(u, 0, db);
		const items = snap.items.filter((i) => i.id !== existing.id);
		expect(items).toHaveLength(5);
		const arrival = items.find((i) => i.title === 'Arrival')!;
		expect(arrival).toMatchObject({
			status: 'done',
			needsMatch: false,
			source: 'https://boxd.it/test2'
		});
		expect(snap.catalogEntries.find((c) => c.id === arrival.catalogEntryId)?.externalId).toBe(
			'movie:329865'
		);
		expect(
			snap.logEntries
				.filter((l) => l.itemId === arrival.id)
				.map((l) => l.rating)
				.sort()
		).toEqual([10, 9].sort());
		const things = items.filter((i) => i.title === 'The Thing');
		expect(new Set(things.map((t) => t.catalogEntryId)).size).toBe(2); // remakes stay separate
		expect(items.find((i) => i.title.startsWith('Crouching'))).toMatchObject({
			needsMatch: true,
			catalogEntryId: null
		});
	});

	it('merges logs into existing items in merge mode and never duplicates them on re-import', async () => {
		const watch = cat({ name: 'Watch', provider: 'tmdb' });
		const old = item(watch.id, { title: 'Arrival', status: 'want' });
		applyMutations(
			u,
			[
				{ kind: 'category', row: watch },
				{ kind: 'item', row: old }
			],
			db
		);
		const parsed = parseAppImport(dir('letterboxd'));
		await startAppImport({
			userId: u,
			parsed,
			categoryId: watch.id,
			duplicates: 'merge',
			provider: null,
			db
		}).done;
		let snap = pull(u, 0, db);
		const arrival = snap.items.find((i) => i.id === old.id)!;
		expect(arrival.status).toBe('done');
		expect(arrival.tags).toEqual(['cinema', 'sci-fi']);
		expect(snap.logEntries.filter((l) => l.itemId === old.id)).toHaveLength(2);
		// TMDB disabled: everything else is custom + needsMatch
		expect(
			snap.items.filter((i) => i.id !== old.id).every((i) => i.needsMatch && !i.catalogEntryId)
		).toBe(true);

		await startAppImport({
			userId: u,
			parsed,
			categoryId: watch.id,
			duplicates: 'merge',
			provider: null,
			db
		}).done;
		snap = pull(u, 0, db);
		expect(snap.items).toHaveLength(6);
		expect(snap.logEntries).toHaveLength(5);
	});

	it('imports Goodreads into a new Read category with the author field', async () => {
		const parsed = parseAppImport([file('goodreads_library_export.csv')]);
		expect(buildPreview(u, parsed, { db, matching: true })).toMatchObject({
			categoryId: null,
			newCategoryName: 'Read',
			matching: false
		});
		const { job, done } = startAppImport({
			userId: u,
			parsed,
			categoryId: 'new',
			provider: mockTmdb(),
			db
		});
		await done;
		const snap = pull(u, 0, db);
		const read = snap.categories.find((c) => c.id === job.categoryId)!;
		expect(read).toMatchObject({
			name: 'Read',
			fieldSchema: [{ key: 'author', label: 'Author', type: 'text' }]
		});
		expect(snap.items).toHaveLength(4);
		expect(snap.items.every((i) => !i.needsMatch && i.categoryId === read.id)).toBe(true);
		expect(snap.items.find((i) => i.title === 'Piranesi')?.createdAt).toBe(
			Date.parse('2023-01-02T12:00:00Z')
		);
		expect(snap.logEntries).toHaveLength(2);
	});

	it('adds the author field to an existing category and stops at the item cap', async () => {
		const books = cat({
			name: 'Books',
			fieldSchema: [{ key: 'pages', label: 'Pages', type: 'number' }]
		});
		applyMutations(u, [{ kind: 'category', row: books }], db);
		const parsed = parseAppImport([file('goodreads_library_export.csv')]);
		const { job, done } = startAppImport({
			userId: u,
			parsed,
			categoryId: books.id,
			provider: null,
			db,
			itemCap: 3
		});
		await done;
		const { getJob } = await import('../../src/lib/server/imports/jobs');
		expect(getJob(job.id, u)).toMatchObject({ status: 'error', created: 3 });
		expect(getJob(job.id, u)?.error).toMatch(/limited to 3 items/);
		const snap = pull(u, 0, db);
		expect(snap.items).toHaveLength(3);
		expect(snap.categories[0].fieldSchema.map((f) => f.key)).toEqual(['pages', 'author']);
	});
});
