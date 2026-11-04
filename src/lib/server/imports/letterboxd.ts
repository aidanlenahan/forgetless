// Letterboxd export (Settings → Import & Export → Export your data): a ZIP with watchlist.csv,
// watched.csv, diary.csv, ratings.csv, reviews.csv (+ likes/, lists/ we ignore).
// Columns: Date, Name, Year, Letterboxd URI [, Rating, Rewatch, Review, Tags, Watched Date].
// One film appears in several files; records are merged by Name+Year so one item gets many log entries.
import type { CsvTable } from '../../shared/csv';
import type { ImportRecord, ParsedImport } from './types';
import {
	addLog,
	dateMs,
	isoDate,
	letterboxdRating,
	newRecord,
	normTitle,
	noteAdded,
	parseYear,
	plainText,
	splitTags,
	today
} from './util';

export type LetterboxdFile = 'watchlist' | 'watched' | 'diary' | 'ratings' | 'reviews';
export const LETTERBOXD_FILES: LetterboxdFile[] = [
	'watched',
	'watchlist',
	'diary',
	'reviews',
	'ratings'
];

/** Which Letterboxd file a table is, from its filename first and its headers second. */
export function letterboxdFileKind(name: string, headers: string[]): LetterboxdFile | null {
	if (!headers.includes('Letterboxd URI') || !headers.includes('Name')) return null;
	const base = name
		.split('/')
		.pop()!
		.toLowerCase()
		.replace(/\.csv$/, '');
	if ((LETTERBOXD_FILES as string[]).includes(base)) return base as LetterboxdFile;
	if (headers.includes('Review')) return 'reviews';
	if (headers.includes('Watched Date')) return 'diary';
	if (headers.includes('Rating')) return 'ratings';
	return base.includes('watchlist') ? 'watchlist' : 'watched';
}

export function parseLetterboxd(
	tables: { kind: LetterboxdFile; table: CsvTable }[]
): ImportRecord[] {
	const byKey = new Map<string, ImportRecord>();
	const ratingOnly = new Map<string, { date: string; rating: number }>();

	const filmUri = new Set<string>(); // records whose source is already a film (not diary-entry) link

	const recFor = (row: Record<string, string>, fromFilm: boolean): ImportRecord | null => {
		const title = (row['Name'] ?? '').trim();
		if (!title) return null;
		const year = parseYear(row['Year']);
		const key = `${normTitle(title)}|${year ?? ''}`;
		let rec = byKey.get(key);
		if (!rec) {
			rec = newRecord({ key, title, year, kind: 'movie' });
			byKey.set(key, rec);
		}
		// watched/watchlist/ratings URIs point at the film; diary/review URIs at the entry. Prefer film links.
		const uri = (row['Letterboxd URI'] ?? '').trim();
		if (/^https?:\/\//.test(uri) && !filmUri.has(key) && (fromFilm || !rec.source)) {
			rec.source = uri;
			if (fromFilm) filmUri.add(key);
		}
		return rec;
	};

	const ordered = [...tables].sort(
		(a, b) => LETTERBOXD_FILES.indexOf(a.kind) - LETTERBOXD_FILES.indexOf(b.kind)
	);
	for (const { kind, table } of ordered) {
		const fromFilm = kind === 'watched' || kind === 'watchlist' || kind === 'ratings';
		for (const row of table.rows) {
			const rec = recFor(row, fromFilm);
			if (!rec) continue;
			const added = dateMs(row['Date']);
			if (kind === 'watchlist') {
				noteAdded(rec, added);
				continue;
			}
			rec.status = 'done';
			if (kind === 'watched') {
				noteAdded(rec, added);
				continue;
			}
			if (kind === 'ratings') {
				const rating = letterboxdRating(row['Rating']);
				if (rating != null)
					ratingOnly.set(rec.key, { date: isoDate(row['Date']) ?? today(), rating });
				continue;
			}
			// diary / reviews: dated log entries
			const date = isoDate(row['Watched Date']) ?? isoDate(row['Date']) ?? today();
			const rating = letterboxdRating(row['Rating']);
			const review = plainText(row['Review']);
			const rewatch = /^yes$/i.test((row['Rewatch'] ?? '').trim());
			for (const t of splitTags(row['Tags'])) if (!rec.tags.includes(t)) rec.tags.push(t);
			if (kind === 'reviews') {
				// A review usually belongs to a diary entry on the same date: attach the text to it.
				const target = rec.logs.find((l) => l.date === date && (!l.note || l.note === 'Rewatch'));
				if (target && review) {
					target.note = target.note === 'Rewatch' ? `Rewatch\n${review}` : review;
					if (target.rating == null) target.rating = rating;
					continue;
				}
			}
			const note = [rewatch ? 'Rewatch' : null, review].filter(Boolean).join('\n') || null;
			addLog(rec, { date, rating, note });
		}
	}
	// ratings.csv only adds a rating when there's no diary entry for the film.
	for (const [key, r] of ratingOnly) {
		const rec = byKey.get(key)!;
		if (!rec.logs.length) rec.logs.push({ date: r.date, rating: r.rating, note: null });
	}
	for (const rec of byKey.values()) {
		if (!rec.source) rec.source = 'Letterboxd';
		rec.logs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	}
	return [...byKey.values()];
}

export function letterboxdImport(
	tables: { name: string; kind: LetterboxdFile; table: CsvTable }[]
): ParsedImport {
	const kinds = new Set(tables.map((t) => t.kind));
	const warnings: string[] = [];
	if (kinds.has('diary') && !kinds.has('watched'))
		warnings.push('No watched.csv: only films in your diary will be marked as watched.');
	return {
		source: 'letterboxd',
		records: parseLetterboxd(tables),
		files: tables.map((t) => t.name),
		warnings
	};
}
