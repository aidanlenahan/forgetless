// Small formatting helpers for the UI.

const rtf =
	typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

/** "just now", "5 minutes ago", "3 months ago" … */
export function timeAgo(ms: number, now: number = Date.now()): string {
	const diff = ms - now; // negative = past
	const abs = Math.abs(diff);
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 365 * 86_400_000],
		['month', 30 * 86_400_000],
		['week', 7 * 86_400_000],
		['day', 86_400_000],
		['hour', 3_600_000],
		['minute', 60_000]
	];
	if (abs < 60_000) return 'just now';
	for (const [unit, size] of units) {
		if (abs >= size) {
			const v = Math.round(diff / size);
			return rtf
				? rtf.format(v, unit)
				: `${Math.abs(v)} ${unit}${Math.abs(v) === 1 ? '' : 's'} ago`;
		}
	}
	return 'just now';
}

/** "2026-03-04" -> "Mar 4, 2026" (local, no TZ shift). */
export function formatDay(day: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
	if (!m) return day;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Rating stored 1–10 -> "3.5". */
export function ratingLabel(r: number | null | undefined): string {
	if (r == null) return 'No rating';
	const stars = r / 2;
	return `${stars % 1 ? stars.toFixed(1) : stars} / 5`;
}

export function slugKey(label: string): string {
	return (
		label
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '') || 'field'
	);
}

export function isUrl(s: string | null | undefined): boolean {
	return !!s && /^https?:\/\/\S+$/i.test(s.trim());
}
