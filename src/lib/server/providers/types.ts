import type { CatalogEntry, CatalogHit } from '../../shared/types';

export interface SearchOpts {
	/** Restrict to one kind (e.g. 'movie' or 'tv'). */
	kind?: string;
	limit?: number;
	signal?: AbortSignal;
}

/** A catalog entry as produced by a provider, before it has a local id. */
export type ProviderEntry = Omit<CatalogEntry, 'id'>;

/** PRD §7 provider contract. Providers run server-side only. */
export interface Provider {
	id: string; // 'tmdb'
	kinds: string[]; // ['movie', 'tv']
	search(q: string, opts?: SearchOpts): Promise<CatalogHit[]>;
	getDetails(externalId: string, kind?: string): Promise<ProviderEntry>;
	attribution: { text: string; logo?: string; url: string };
}

export class ProviderError extends Error {
	constructor(
		message: string,
		public status = 502
	) {
		super(message);
	}
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
