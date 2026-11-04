// TMDB v3 API adapter. The key is a v4 "API Read Access Token" sent as a Bearer token.
// External ids are "<kind>:<tmdb id>" (e.g. "movie:550", "tv:1399") because TMDB movie and TV ids overlap
// and catalog_entries is UNIQUE(source, external_id).
import type { CatalogHit } from '../../shared/types';
import {
	ProviderError,
	type FetchLike,
	type Provider,
	type ProviderEntry,
	type SearchOpts
} from './types';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const KINDS = ['movie', 'tv'] as const;
type Kind = (typeof KINDS)[number];

const KIND_LABEL: Record<Kind, string> = { movie: 'Movie', tv: 'TV' };

interface TmdbResult {
	id: number;
	media_type?: string;
	title?: string;
	name?: string;
	original_title?: string;
	original_name?: string;
	release_date?: string;
	first_air_date?: string;
	poster_path?: string | null;
	overview?: string;
	genres?: { id: number; name: string }[];
	runtime?: number | null;
	number_of_seasons?: number | null;
	number_of_episodes?: number | null;
	tagline?: string | null;
}

const isKind = (k: unknown): k is Kind =>
	typeof k === 'string' && (KINDS as readonly string[]).includes(k);

export function parseYear(date: string | undefined | null): number | null {
	const m = /^(\d{4})/.exec(date ?? '');
	return m ? Number(m[1]) : null;
}

export function tmdbSubtitle(kind: Kind, year: number | null): string {
	return year ? `${KIND_LABEL[kind]} · ${year}` : KIND_LABEL[kind];
}

/** Parses "movie:550" (or bare "550" with a kind) into its parts. */
export function parseTmdbId(externalId: string, kind?: string): { kind: Kind; id: string } {
	const m = /^(movie|tv)[:/-](\d+)$/.exec(externalId);
	if (m) return { kind: m[1] as Kind, id: m[2] };
	if (/^\d+$/.test(externalId) && isKind(kind)) return { kind, id: externalId };
	throw new ProviderError('invalid TMDB id', 400);
}

export function mapSearchResult(r: TmdbResult, kind: Kind): CatalogHit {
	const year = parseYear(kind === 'movie' ? r.release_date : r.first_air_date);
	return {
		source: 'tmdb',
		externalId: `${kind}:${r.id}`,
		kind,
		title: (kind === 'movie' ? r.title : r.name) ?? r.title ?? r.name ?? 'Untitled',
		subtitle: tmdbSubtitle(kind, year),
		year,
		imageUrl: r.poster_path ? `${IMG}/w185${r.poster_path}` : null
	};
}

export function mapDetails(r: TmdbResult, kind: Kind, now = Date.now()): ProviderEntry {
	const year = parseYear(kind === 'movie' ? r.release_date : r.first_air_date);
	const data: Record<string, unknown> = {
		overview: r.overview || null,
		genres: (r.genres ?? []).map((g) => g.name),
		original_title: (kind === 'movie' ? r.original_title : r.original_name) ?? null,
		tmdb_url: `https://www.themoviedb.org/${kind}/${r.id}`
	};
	if (kind === 'movie') data.runtime = r.runtime ?? null;
	else {
		data.seasons = r.number_of_seasons ?? null;
		data.episodes = r.number_of_episodes ?? null;
	}
	if (r.tagline) data.tagline = r.tagline;
	return {
		source: 'tmdb',
		externalId: `${kind}:${r.id}`,
		kind,
		title: (kind === 'movie' ? r.title : r.name) ?? 'Untitled',
		subtitle: tmdbSubtitle(kind, year),
		year,
		imageUrl: r.poster_path ? `${IMG}/w342${r.poster_path}` : null,
		data,
		fetchedAt: now
	};
}

export function createTmdbProvider(
	apiKey: string,
	fetchImpl: FetchLike = (u, i) => fetch(u, i)
): Provider {
	async function get<T>(
		path: string,
		params: Record<string, string>,
		signal?: AbortSignal
	): Promise<T> {
		const url = `${API}${path}?${new URLSearchParams({ language: 'en-US', ...params })}`;
		let res: Response;
		try {
			res = await fetchImpl(url, {
				headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' },
				signal: signal ?? AbortSignal.timeout(8000)
			});
		} catch (e) {
			throw new ProviderError(`TMDB request failed: ${(e as Error).message}`, 502);
		}
		if (res.status === 404) throw new ProviderError('Not found on TMDB', 404);
		if (res.status === 429) {
			const err = new ProviderError('TMDB rate limit hit', 429);
			err.retryAfter = Number(res.headers.get('retry-after')) || null;
			throw err;
		}
		if (!res.ok) throw new ProviderError(`TMDB responded ${res.status}`, 502);
		return (await res.json()) as T;
	}

	return {
		id: 'tmdb',
		kinds: [...KINDS],
		attribution: {
			text: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
			url: 'https://www.themoviedb.org/'
		},
		async search(q: string, opts: SearchOpts = {}) {
			const query = q.trim();
			if (!query) return [];
			const kind = isKind(opts.kind) ? opts.kind : null;
			const path = kind ? `/search/${kind}` : '/search/multi';
			const params: Record<string, string> = { query, include_adult: 'false', page: '1' };
			if (opts.year && kind === 'movie') params.year = String(opts.year);
			if (opts.year && kind === 'tv') params.first_air_date_year = String(opts.year);
			const body = await get<{ results?: TmdbResult[] }>(path, params, opts.signal);
			const hits: CatalogHit[] = [];
			for (const r of body.results ?? []) {
				const k = kind ?? r.media_type;
				if (!isKind(k)) continue; // drops 'person' results from /search/multi
				hits.push(mapSearchResult(r, k));
			}
			return hits.slice(0, opts.limit ?? 20);
		},
		async getDetails(externalId: string, kind?: string) {
			const p = parseTmdbId(externalId, kind);
			const r = await get<TmdbResult>(`/${p.kind}/${p.id}`, {});
			return mapDetails(r, p.kind);
		},
		async findByExternalId(source: 'imdb', id: string) {
			if (source !== 'imdb' || !/^tt\d{5,10}$/.test(id)) return [];
			const body = await get<{ movie_results?: TmdbResult[]; tv_results?: TmdbResult[] }>(
				`/find/${id}`,
				{ external_source: 'imdb_id' }
			);
			return [
				...(body.movie_results ?? []).map((r) => mapSearchResult(r, 'movie')),
				...(body.tv_results ?? []).map((r) => mapSearchResult(r, 'tv'))
			];
		}
	};
}
