// IMDb CSV exports: ratings.csv (Your Ratings → Export) and list exports (Watchlist or any list → Export).
// ratings: Const, Your Rating, Date Rated, Title, [Original Title,] URL, Title Type, IMDb Rating, …, Year, …
// lists:   Position, Const, Created, Modified, Description, Title, [Original Title,] URL, Title Type, …,
//          Year, …, [Your Rating, Date Rated]
// Records merge by Const (the IMDb id), which is also what we match on (TMDB /find).
import type { CsvTable } from '../../shared/csv';
import type { ImportRecord, ParsedImport } from './types';
import {
	addLog,
	dateMs,
	imdbRating,
	isoDate,
	newRecord,
	noteAdded,
	parseYear,
	today
} from './util';

export type ImdbFile = 'ratings' | 'list';

export function imdbFileKind(headers: string[]): ImdbFile | null {
	if (!headers.includes('Const') || !headers.includes('Title')) return null;
	return headers.includes('Position') || headers.includes('Created') ? 'list' : 'ratings';
}

/** IMDb "Title Type" (old exports: "TV Series", new ones: "tvSeries") → what we match on. */
export function imdbKind(titleType: string | null | undefined): ImportRecord['kind'] {
	const t = (titleType ?? '').toLowerCase().replace(/[^a-z]/g, '');
	if (['movie', 'tvmovie', 'short', 'video', 'tvspecial', 'tvshort', 'feature'].includes(t))
		return 'movie';
	if (['tvseries', 'tvminiseries', 'series', 'miniseries'].includes(t)) return 'tv';
	if (!t) return 'movie';
	return 'other'; // episodes, video games, podcasts…
}

export function parseImdb(
	tables: { kind: ImdbFile; name: string; table: CsvTable }[]
): ImportRecord[] {
	const byConst = new Map<string, ImportRecord>();
	const ratingsFirst = [...tables].sort((a, b) =>
		a.kind === b.kind ? 0 : a.kind === 'ratings' ? -1 : 1
	);
	for (const { kind, table } of ratingsFirst) {
		for (const row of table.rows) {
			const id = (row['Const'] ?? '').trim();
			const title = (row['Title'] ?? '').trim();
			if (!title || !/^tt\d+$/.test(id)) continue;
			let rec = byConst.get(id);
			if (!rec) {
				const url = (row['URL'] ?? '').trim();
				rec = newRecord({
					key: id,
					title,
					year: parseYear(row['Year']),
					kind: imdbKind(row['Title Type']),
					imdbId: id,
					source: /^https?:\/\//.test(url) ? url : `https://www.imdb.com/title/${id}/`,
					customFields: { imdb_id: id }
				});
				byConst.set(id, rec);
			}
			const rating = imdbRating(row['Your Rating']);
			const rated = isoDate(row['Date Rated']);
			if (kind === 'list') {
				noteAdded(rec, dateMs(row['Created']));
				const desc = (row['Description'] ?? '').trim();
				if (desc && !rec.why) rec.why = desc;
			} else {
				noteAdded(rec, dateMs(row['Date Rated']));
			}
			if (rating != null) {
				rec.status = 'done';
				// A list row's rating duplicates ratings.csv when both are uploaded; addLog dedupes it.
				addLog(rec, { date: rated ?? today(), rating, note: null });
			}
		}
	}
	return [...byConst.values()];
}

export function imdbImport(
	tables: { kind: ImdbFile; name: string; table: CsvTable }[]
): ParsedImport {
	return {
		source: 'imdb',
		records: parseImdb(tables),
		files: tables.map((t) => t.name),
		warnings: []
	};
}
