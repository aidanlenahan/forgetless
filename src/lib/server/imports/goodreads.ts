// Goodreads library export (My Books → Import and export → Export Library): goodreads_library_export.csv
// Book Id, Title, Author, Author l-f, Additional Authors, ISBN, ISBN13, My Rating, Average Rating, Publisher,
// Binding, Number of Pages, Year Published, Original Publication Year, Date Read, Date Added, Bookshelves,
// Bookshelves with positions, Exclusive Shelf, My Review, Spoiler, Private Notes, Read Count, Owned Copies
import { unwrapExcel, type CsvTable } from '../../shared/csv';
import type { Status } from '../../shared/types';
import type { ImportRecord, ParsedImport } from './types';
import {
	dateMs,
	goodreadsRating,
	isoDate,
	newRecord,
	normTitle,
	parseYear,
	plainText,
	splitTags,
	today
} from './util';

export function isGoodreads(headers: string[]): boolean {
	return (
		headers.includes('Exclusive Shelf') ||
		(headers.includes('Book Id') && headers.includes('Title') && headers.includes('Author'))
	);
}

export function goodreadsStatus(shelf: string | null | undefined): Status {
	const s = (shelf ?? '').trim().toLowerCase();
	if (s === 'read') return 'done';
	if (s === 'currently-reading') return 'in_progress';
	if (/(^|-)(dnf|did-not-finish|abandoned|gave-up)($|-)/.test(s)) return 'dropped';
	return 'want';
}

const BUILTIN_SHELVES = ['to-read', 'currently-reading', 'read'];

export function parseGoodreads(table: CsvTable): ImportRecord[] {
	const out = new Map<string, ImportRecord>();
	for (const raw of table.rows) {
		const row: Record<string, string> = {};
		for (const [k, v] of Object.entries(raw)) row[k] = unwrapExcel(v);
		const title = row['Title']?.trim();
		if (!title) continue;
		const author = row['Author']?.trim() || null;
		const bookId = row['Book Id']?.trim();
		const key = bookId ? `gr:${bookId}` : `${normTitle(title)}|${normTitle(author ?? '')}`;
		if (out.has(key)) continue;
		const shelf = row['Exclusive Shelf']?.trim() || 'to-read';
		const isbn = row['ISBN13'] || row['ISBN'] || null;
		const customFields: Record<string, unknown> = {};
		if (author) customFields.author = author;
		if (isbn) customFields.isbn = isbn;
		const rec = newRecord({
			key,
			title,
			year: parseYear(row['Original Publication Year']) ?? parseYear(row['Year Published']),
			kind: 'book',
			status: goodreadsStatus(shelf),
			source: bookId ? `https://www.goodreads.com/book/show/${bookId}` : 'Goodreads',
			why: plainText(row['Private Notes']),
			tags: splitTags(row['Bookshelves'], [...BUILTIN_SHELVES, shelf]),
			customFields,
			addedAt: dateMs(row['Date Added'])
		});
		const read = isoDate(row['Date Read']);
		const rating = goodreadsRating(row['My Rating']);
		const review = plainText(row['My Review']);
		if (read || rating != null) {
			rec.logs.push({
				date: read ?? isoDate(row['Date Added']) ?? today(),
				rating,
				note: review
			});
		} else if (review && rec.status === 'done') {
			rec.logs.push({ date: isoDate(row['Date Added']) ?? today(), rating: null, note: review });
		}
		out.set(key, rec);
	}
	return [...out.values()];
}

export function goodreadsImport(tables: { name: string; table: CsvTable }[]): ParsedImport {
	return {
		source: 'goodreads',
		records: tables.flatMap((t) => parseGoodreads(t.table)),
		files: tables.map((t) => t.name),
		warnings: []
	};
}
