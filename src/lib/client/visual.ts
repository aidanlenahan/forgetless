// Presentation helpers shared by components: category tints and TMDB image sizing.
import type { Category } from '../shared/types';

/** Number of category tints defined in app.css (--cat-0-* … --cat-6-*). */
export const TINT_COUNT = 7;

/** Tint index for a category, keyed by its sort position so the colour stays stable across devices. */
export function tintIndex(c: Pick<Category, 'sort'> | null | undefined): number {
	if (!c) return TINT_COUNT - 1;
	const n = Math.abs(Math.trunc(c.sort ?? 0));
	return n % TINT_COUNT;
}

/** Inline style that exposes a category's tint as --tint-bg / --tint-ink to a subtree. */
export function tintStyle(c: Pick<Category, 'sort'> | null | undefined): string {
	const i = tintIndex(c);
	return `--tint-bg: var(--cat-${i}-bg); --tint-ink: var(--cat-${i}-ink);`;
}

// TMDB serves posters at fixed widths; pick the smallest one that covers the rendered size.
const TMDB_WIDTHS = [92, 154, 185, 342, 500, 780] as const;
const TMDB_RE = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)(\/.+)$/;

function tmdbAt(m: RegExpExecArray, px: number): string {
	const w = TMDB_WIDTHS.find((x) => x >= px) ?? 'original';
	return `${m[1]}${typeof w === 'number' ? `w${w}` : w}${m[2]}`;
}

/** `src` and `srcset` for a poster rendered `width` CSS pixels wide (1x and 2x). */
export function posterSources(
	url: string | null | undefined,
	width: number
): { src: string; srcset?: string } | null {
	if (!url) return null;
	const m = TMDB_RE.exec(url);
	if (!m) return { src: url };
	const one = tmdbAt(m, width);
	const two = tmdbAt(m, width * 2);
	return one === two ? { src: one } : { src: one, srcset: `${one} 1x, ${two} 2x` };
}

/** First letter (grapheme) of a title, for typographic placeholders. */
export function initialOf(title: string | null | undefined): string {
	const t = (title ?? '').trim().replace(/^(the|a|an)\s+/i, '');
	if (!t) return '';
	const seg =
		typeof Intl !== 'undefined' && 'Segmenter' in Intl
			? [...new Intl.Segmenter().segment(t)][0]?.segment
			: [...t][0];
	return (seg ?? '').toUpperCase();
}
