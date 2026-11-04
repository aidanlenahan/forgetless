import type { AppImportSource, Status } from '../../shared/types';

export interface ImportLog {
	date: string; // YYYY-MM-DD
	rating: number | null; // 1-10
	note: string | null;
}

/** One thing to import, normalised across apps. Several source rows can merge into one record. */
export interface ImportRecord {
	/** dedupe key within one import (e.g. Letterboxd name+year, IMDb const, Goodreads book id) */
	key: string;
	title: string;
	year: number | null;
	/** what to match against: TMDB movie/tv, books (no provider yet) or anything else (never matched) */
	kind: 'movie' | 'tv' | 'book' | 'other';
	imdbId: string | null;
	status: Status;
	source: string | null;
	why: string | null;
	tags: string[];
	customFields: Record<string, unknown>;
	/** epoch ms the user added it in the other app, if known */
	addedAt: number | null;
	logs: ImportLog[];
}

export interface ParsedImport {
	source: AppImportSource;
	records: ImportRecord[];
	files: string[];
	warnings: string[];
}

export interface CsvFile {
	name: string;
	text: string;
}

export class AppImportError extends Error {
	constructor(
		message: string,
		public status = 400
	) {
		super(message);
	}
}
