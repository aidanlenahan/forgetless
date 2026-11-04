// Helpers shared by the app-import parsers: dates, ratings, title normalisation.
import type { ImportLog, ImportRecord } from './types';

/** Lower-case, strip accents and punctuation, '&' → 'and', collapse spaces. Used for matching. */
export function normTitle(s: string): string {
	return s
		.toLocaleLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/&/g, ' and ')
		.replace(/['’`]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/** "2023-05-14", "2023/05/14", "2023-05-14T…" → "2023-05-14"; anything else → null. */
export function isoDate(v: string | null | undefined): string | null {
	const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec((v ?? '').trim());
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Epoch ms (UTC noon, so the calendar date survives any timezone) for a parseable date. */
export function dateMs(v: string | null | undefined): number | null {
	const d = isoDate(v);
	return d ? Date.parse(`${d}T12:00:00Z`) : null;
}

export function parseYear(v: string | null | undefined): number | null {
	const m = /\b(\d{4})\b/.exec(v ?? '');
	if (!m) return null;
	const y = Number(m[1]);
	return y >= 1000 && y <= 2999 ? y : null;
}

const clamp10 = (n: number) => Math.min(10, Math.max(1, Math.round(n)));

/** Letterboxd 0.5–5 stars (half steps) → 1–10. */
export function letterboxdRating(v: string | null | undefined): number | null {
	const n = Number((v ?? '').trim());
	return v?.trim() && Number.isFinite(n) && n > 0 ? clamp10(n * 2) : null;
}

/** IMDb 1–10 → 1–10. */
export function imdbRating(v: string | null | undefined): number | null {
	const n = Number((v ?? '').trim());
	return v?.trim() && Number.isFinite(n) && n > 0 ? clamp10(n) : null;
}

/** Goodreads 1–5 stars → 2–10 (0 means "not rated"). */
export function goodreadsRating(v: string | null | undefined): number | null {
	const n = Number((v ?? '').trim());
	return v?.trim() && Number.isFinite(n) && n > 0 ? clamp10(n * 2) : null;
}

/** Review text from exports can contain light HTML (<br/>, <i>). Make it plain text. */
export function plainText(v: string | null | undefined): string | null {
	const s = (v ?? '')
		.replace(/\r\n?/g, '\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>\s*<p>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return s || null;
}

export function splitTags(v: string | null | undefined, exclude: string[] = []): string[] {
	const ex = new Set(exclude.map((x) => x.toLowerCase()));
	return [
		...new Set(
			(v ?? '')
				.split(',')
				.map((t) => t.trim().toLowerCase())
				.filter((t) => t && !ex.has(t))
		)
	];
}

export function addLog(rec: ImportRecord, log: ImportLog) {
	if (rec.logs.some((l) => l.date === log.date && l.rating === log.rating && l.note === log.note))
		return;
	rec.logs.push(log);
}

export const today = () => new Date().toISOString().slice(0, 10);

export function newRecord(p: Partial<ImportRecord> & Pick<ImportRecord, 'key' | 'title'>) {
	const r: ImportRecord = {
		year: null,
		kind: 'other',
		imdbId: null,
		status: 'want',
		source: null,
		why: null,
		tags: [],
		customFields: {},
		addedAt: null,
		logs: [],
		...p
	};
	return r;
}

/** Earliest known "added" time wins. */
export function noteAdded(rec: ImportRecord, ms: number | null) {
	if (ms != null && (rec.addedAt == null || ms < rec.addedAt)) rec.addedAt = ms;
}
