// Time zone helpers built on Intl (no dependencies). All instants are epoch ms.

export interface LocalParts {
	y: number;
	/** 1–12 */
	m: number;
	d: number;
	hour: number;
	minute: number;
	/** 0 = Sunday */
	weekday: number;
}

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
	let f = fmts.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric'
		});
		fmts.set(tz, f);
	}
	return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
	if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
	try {
		fmt(tz);
		return true;
	} catch {
		return false;
	}
}

export function localParts(ts: number, tz: string): LocalParts {
	const p: Record<string, number> = {};
	for (const part of fmt(tz).formatToParts(new Date(ts)))
		if (part.type !== 'literal') p[part.type] = Number(part.value);
	const hour = p.hour === 24 ? 0 : p.hour;
	return {
		y: p.year,
		m: p.month,
		d: p.day,
		hour,
		minute: p.minute,
		weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
	};
}

/** Offset of `tz` from UTC at instant `ts`, in ms (local = utc + offset). */
function offsetAt(ts: number, tz: string): number {
	const p = localParts(ts, tz);
	const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute);
	return asUtc - (ts - (((ts % 60_000) + 60_000) % 60_000));
}

/** The instant at which the wall clock in `tz` reads y-m-d hour:minute (m is 1–12). Day overflow is fine. */
export function zonedToUtc(
	y: number,
	m: number,
	d: number,
	hour: number,
	minute: number,
	tz: string
) {
	const guess = Date.UTC(y, m - 1, d, hour, minute);
	const t1 = guess - offsetAt(guess, tz);
	const t2 = guess - offsetAt(t1, tz);
	return t2;
}

/** "YYYY-MM-DD" for a calendar date given as UTC-normalised y/m/d (handles overflow like d = 0). */
export function dateKey(y: number, m: number, d: number): string {
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.toISOString().slice(0, 10);
}

export function localDateKey(ts: number, tz: string): string {
	const p = localParts(ts, tz);
	return dateKey(p.y, p.m, p.d);
}

export function startOfLocalDay(ts: number, tz: string): number {
	const p = localParts(ts, tz);
	return zonedToUtc(p.y, p.m, p.d, 0, 0, tz);
}

export function daysInMonth(y: number, m: number): number {
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const DAY_MS = 24 * 60 * 60 * 1000;
