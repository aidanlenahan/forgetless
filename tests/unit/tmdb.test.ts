import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTmdbProvider, parseTmdbId } from '../../src/lib/server/providers/tmdb';
import { cachedSearch, selectEntry, setProviders, DETAILS_TTL_MS } from '../../src/lib/server/providers';
import { ProviderError } from '../../src/lib/server/providers/types';
import { makeDb } from './helpers';

const jsonRes = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const multi = {
	results: [
		{ id: 329865, media_type: 'movie', title: 'Arrival', release_date: '2016-11-10', poster_path: '/a.jpg' },
		{ id: 95396, media_type: 'tv', name: 'Severance', first_air_date: '2022-02-17', poster_path: null },
		{ id: 1, media_type: 'person', name: 'Somebody' },
		{ id: 2, media_type: 'movie', title: 'Undated', release_date: '' }
	]
};

const movieDetails = {
	id: 329865,
	title: 'Arrival',
	original_title: 'Arrival',
	release_date: '2016-11-10',
	poster_path: '/a.jpg',
	overview: 'Aliens land.',
	genres: [{ id: 18, name: 'Drama' }, { id: 878, name: 'Science Fiction' }],
	runtime: 116
};
const tvDetails = {
	id: 95396,
	name: 'Severance',
	original_name: 'Severance',
	first_air_date: '2022-02-17',
	poster_path: '/s.jpg',
	overview: 'Work/life.',
	genres: [{ id: 18, name: 'Drama' }],
	number_of_seasons: 2,
	number_of_episodes: 19
};

function mockFetch() {
	return vi.fn(async (url: string, init?: RequestInit) => {
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
		const u = new URL(url);
		if (u.pathname === '/3/search/multi') return jsonRes(multi);
		if (u.pathname === '/3/search/movie') return jsonRes({ results: [multi.results[0]] });
		if (u.pathname === '/3/search/tv') return jsonRes({ results: [multi.results[1]] });
		if (u.pathname === '/3/movie/329865') return jsonRes(movieDetails);
		if (u.pathname === '/3/tv/95396') return jsonRes(tvDetails);
		if (u.pathname === '/3/movie/500') return jsonRes({ status_message: 'boom' }, 500);
		return jsonRes({ status_message: 'not found' }, 404);
	});
}

describe('TMDB provider', () => {
	let fetchMock: ReturnType<typeof mockFetch>;
	beforeEach(() => {
		fetchMock = mockFetch();
	});

	it('maps /search/multi to movie|tv hits', async () => {
		const p = createTmdbProvider('test-token', fetchMock);
		const hits = await p.search('arr');
		expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('query')).toBe('arr');
		expect(hits).toEqual([
			{
				source: 'tmdb',
				externalId: 'movie:329865',
				kind: 'movie',
				title: 'Arrival',
				subtitle: 'Movie · 2016',
				year: 2016,
				imageUrl: 'https://image.tmdb.org/t/p/w185/a.jpg'
			},
			{
				source: 'tmdb',
				externalId: 'tv:95396',
				kind: 'tv',
				title: 'Severance',
				subtitle: 'TV · 2022',
				year: 2022,
				imageUrl: null
			},
			{ source: 'tmdb', externalId: 'movie:2', kind: 'movie', title: 'Undated', subtitle: 'Movie', year: null, imageUrl: null }
		]);
	});

	it('uses the kind-specific endpoint when kind is given', async () => {
		const p = createTmdbProvider('test-token', fetchMock);
		const hits = await p.search('sev', { kind: 'tv' });
		expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/3/search/tv');
		expect(hits.map((h) => h.externalId)).toEqual(['tv:95396']);
	});

	it('maps movie and tv details', async () => {
		const p = createTmdbProvider('test-token', fetchMock);
		const m = await p.getDetails('movie:329865');
		expect(m).toMatchObject({
			source: 'tmdb',
			externalId: 'movie:329865',
			kind: 'movie',
			title: 'Arrival',
			subtitle: 'Movie · 2016',
			year: 2016,
			imageUrl: 'https://image.tmdb.org/t/p/w342/a.jpg',
			data: {
				overview: 'Aliens land.',
				genres: ['Drama', 'Science Fiction'],
				runtime: 116,
				original_title: 'Arrival',
				tmdb_url: 'https://www.themoviedb.org/movie/329865'
			}
		});
		const t = await p.getDetails('95396', 'tv');
		expect(t).toMatchObject({
			externalId: 'tv:95396',
			kind: 'tv',
			subtitle: 'TV · 2022',
			data: { seasons: 2, episodes: 19, original_title: 'Severance', tmdb_url: 'https://www.themoviedb.org/tv/95396' }
		});
	});

	it('maps errors to ProviderError', async () => {
		const p = createTmdbProvider('test-token', fetchMock);
		await expect(p.getDetails('movie:404')).rejects.toMatchObject({ status: 404 });
		await expect(p.getDetails('movie:500')).rejects.toMatchObject({ status: 502 });
		await expect(p.getDetails('garbage')).rejects.toBeInstanceOf(ProviderError);
		expect(parseTmdbId('tv:5')).toEqual({ kind: 'tv', id: '5' });
	});

	it('caches searches in memory (normalised query)', async () => {
		const p = createTmdbProvider('test-token', fetchMock);
		setProviders([p]);
		await cachedSearch(p, 'Arrival');
		await cachedSearch(p, '  arrival ');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await cachedSearch(p, 'arrival', { kind: 'movie' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		setProviders(null);
	});

	it('caches details in catalog_entries and refetches after 7 days', async () => {
		const db = makeDb();
		const p = createTmdbProvider('test-token', fetchMock);
		const now = Date.now();
		const e1 = await selectEntry(p, 'movie:329865', 'movie', db, now);
		expect(e1.id).toBe('tmdb-movie-329865');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const e2 = await selectEntry(p, '329865', 'movie', db, now + 1000);
		expect(e2).toEqual(e1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await selectEntry(p, 'movie:329865', 'movie', db, now + DETAILS_TTL_MS + 1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const n = db.sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_entries').get() as { n: number };
		expect(n.n).toBe(1);
	});
});
