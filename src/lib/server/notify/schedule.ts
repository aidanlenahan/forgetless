// When digests and resurface reminders are due, in the user's local time. Pure functions (clock injected).
import { DAY_MS, dateKey, daysInMonth, localParts, zonedToUtc } from './time';
import type { NotificationPrefs } from '../../shared/notifications';

export interface Slot {
	/** idempotency key for notification_log, e.g. "2026-11-08" */
	periodKey: string;
	/** the instant the slot starts */
	at: number;
}

type SchedPrefs = Pick<
	NotificationPrefs,
	'digestFrequency' | 'digestDayOfWeek' | 'digestDayOfMonth' | 'digestHour' | 'timezone'
>;

function slotOn(y: number, m: number, d: number, p: Pick<SchedPrefs, 'digestHour' | 'timezone'>) {
	return { periodKey: dateKey(y, m, d), at: zonedToUtc(y, m, d, p.digestHour, 0, p.timezone) };
}

/** Digest slots around `now`, newest first: the candidates for "latest due" and "next". */
function digestSlots(p: SchedPrefs, now: number, dir: -1 | 1): Slot[] {
	const l = localParts(now, p.timezone);
	const out: Slot[] = [];
	if (p.digestFrequency === 'weekly') {
		for (let k = 0; k <= 14; k++) {
			const dd = l.d + dir * k;
			const wd = new Date(Date.UTC(l.y, l.m - 1, dd)).getUTCDay();
			if (wd === p.digestDayOfWeek) out.push(slotOn(l.y, l.m, dd, p));
		}
	} else if (p.digestFrequency === 'monthly') {
		for (let k = 0; k <= 2; k++) {
			const mm = l.m + dir * k;
			const y = l.y + Math.floor((mm - 1) / 12);
			const m = ((((mm - 1) % 12) + 12) % 12) + 1;
			out.push(slotOn(y, m, Math.min(p.digestDayOfMonth, daysInMonth(y, m)), p));
		}
	}
	return out;
}

/** The most recent digest slot at or before `now` (null when digests are off). */
export function latestDigestSlot(p: SchedPrefs, now: number): Slot | null {
	return digestSlots(p, now, -1).find((s) => s.at <= now) ?? null;
}

/** The first digest slot after `now`. */
export function nextDigestSlot(p: SchedPrefs, now: number): Slot | null {
	return digestSlots(p, now, 1).find((s) => s.at > now) ?? null;
}

/** Resurface reminders: at most one per local day, at the digest hour. */
export function latestDailySlot(p: Pick<SchedPrefs, 'digestHour' | 'timezone'>, now: number): Slot {
	const l = localParts(now, p.timezone);
	const today = slotOn(l.y, l.m, l.d, p);
	return today.at <= now ? today : slotOn(l.y, l.m, l.d - 1, p);
}
export function nextDailySlot(p: Pick<SchedPrefs, 'digestHour' | 'timezone'>, now: number): Slot {
	const l = localParts(now, p.timezone);
	const today = slotOn(l.y, l.m, l.d, p);
	return today.at > now ? today : slotOn(l.y, l.m, l.d + 1, p);
}

export { DAY_MS };
