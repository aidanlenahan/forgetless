// Delivery policy: who may get notifications, quiet hours (defer, never drop) and the daily cap.
import { parseHm } from '../../shared/notifications';
import type { DB } from '../db';
import { localParts, startOfLocalDay } from './time';
import type { StoredPrefs } from './prefs';

type QuietPrefs = Pick<StoredPrefs, 'quietStart' | 'quietEnd' | 'timezone'>;

/** True while the user's local clock is inside quiet hours. Handles windows across midnight. */
export function inQuietHours(p: QuietPrefs, now: number): boolean {
	const s = parseHm(p.quietStart);
	const e = parseHm(p.quietEnd);
	if (s == null || e == null || s === e) return false;
	const l = localParts(now, p.timezone);
	const m = l.hour * 60 + l.minute;
	return s < e ? m >= s && m < e : m >= s || m < e;
}

/** Distinct scheduled notifications (digest/resurface, any channel) sent today in the user's time zone. */
export function sentToday(db: DB, userId: string, tz: string, now: number): number {
	const from = startOfLocalDay(now, tz);
	const r = db.sqlite
		.prepare(
			`SELECT COUNT(DISTINCT kind || ':' || period_key) AS n FROM notification_log
			 WHERE user_id = ? AND status = 'sent' AND kind != 'test' AND sent_at >= ?`
		)
		.get(userId, from) as { n: number };
	return r.n;
}

export function capReached(
	db: DB,
	p: Pick<StoredPrefs, 'userId' | 'timezone' | 'dailyCap'>,
	now: number
) {
	return sentToday(db, p.userId, p.timezone, now) >= p.dailyCap;
}

/** Guest (demo) accounts never get notifications. */
export function isNotifiableUser(u: { isGuest?: boolean | null; email?: string | null } | null) {
	return !!u && !u.isGuest;
}

/** Real mailbox? Demo accounts use @demo.invalid. */
export const deliverableEmail = (email: string | null | undefined) =>
	!!email && /^[^@\s]+@[^@\s]+$/.test(email) && !/\.invalid$/i.test(email);
