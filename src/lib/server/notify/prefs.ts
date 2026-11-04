// Read / validate / save a user's notification settings (table notification_prefs).
import { eq } from 'drizzle-orm';
import { schema, type DB } from '../db';
import { isValidTimeZone } from './time';
import {
	DEFAULT_PREFS,
	formatHm,
	parseHm,
	type DigestFrequency,
	type NotificationPrefs
} from '../../shared/notifications';

type PrefsRow = typeof schema.notificationPrefs.$inferSelect;

/** Prefs plus bookkeeping the scheduler needs. */
export interface StoredPrefs extends NotificationPrefs {
	userId: string;
	scheduleChangedAt: number;
	updatedAt: number;
}

export function rowToPrefs(r: PrefsRow): StoredPrefs {
	return {
		userId: r.userId,
		emailEnabled: r.emailEnabled,
		pushEnabled: r.pushEnabled,
		digestFrequency: r.digestFrequency,
		digestDayOfWeek: r.digestDayOfWeek,
		digestDayOfMonth: r.digestDayOfMonth,
		digestHour: r.digestHour,
		digestItemsPerCategory: r.digestItemsPerCategory,
		digestCategoryIds: r.digestCategoryIds ?? null,
		resurfaceEnabled: r.resurfaceEnabled,
		resurfaceAfterMonths: r.resurfaceAfterMonths,
		quietStart: formatHm(r.quietStart),
		quietEnd: formatHm(r.quietEnd),
		timezone: isValidTimeZone(r.timezone) ? r.timezone : 'UTC',
		dailyCap: r.dailyCap,
		scheduleChangedAt: r.scheduleChangedAt,
		updatedAt: r.updatedAt
	};
}

export function getStoredPrefs(db: DB, userId: string): StoredPrefs | null {
	const r = db
		.select()
		.from(schema.notificationPrefs)
		.where(eq(schema.notificationPrefs.userId, userId))
		.get();
	return r ? rowToPrefs(r) : null;
}

/** The user's prefs, or defaults (with `saved: false`) when they never saved any. */
export function getPrefs(db: DB, userId: string): { prefs: NotificationPrefs; saved: boolean } {
	const p = getStoredPrefs(db, userId);
	if (!p) return { prefs: { ...DEFAULT_PREFS }, saved: false };
	const { userId: _u, scheduleChangedAt: _s, updatedAt: _t, ...prefs } = p;
	return { prefs, saved: true };
}

const int = (v: unknown, d: number, min: number, max: number) =>
	typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Validates a (partial) prefs body over `base`. Unknown / invalid values fall back to `base`. */
export function normalizePrefs(input: unknown, base: NotificationPrefs): NotificationPrefs {
	const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
	const freq: DigestFrequency = (['off', 'weekly', 'monthly'] as const).includes(
		b.digestFrequency as DigestFrequency
	)
		? (b.digestFrequency as DigestFrequency)
		: base.digestFrequency;
	let cats = base.digestCategoryIds;
	if (b.digestCategoryIds === null) cats = null;
	else if (Array.isArray(b.digestCategoryIds))
		cats = [
			...new Set(
				b.digestCategoryIds.filter(
					(x): x is string => typeof x === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(x)
				)
			)
		].slice(0, 100);
	let quietStart = base.quietStart;
	let quietEnd = base.quietEnd;
	if ('quietStart' in b || 'quietEnd' in b) {
		const s = parseHm(b.quietStart);
		const e = parseHm(b.quietEnd);
		// Both or neither: one bound alone means nothing.
		quietStart = s != null && e != null && s !== e ? formatHm(s) : null;
		quietEnd = quietStart ? formatHm(e) : null;
	}
	return {
		emailEnabled: bool(b.emailEnabled, base.emailEnabled),
		pushEnabled: bool(b.pushEnabled, base.pushEnabled),
		digestFrequency: freq,
		digestDayOfWeek: int(b.digestDayOfWeek, base.digestDayOfWeek, 0, 6),
		digestDayOfMonth: int(b.digestDayOfMonth, base.digestDayOfMonth, 1, 31),
		digestHour: int(b.digestHour, base.digestHour, 0, 23),
		digestItemsPerCategory: int(b.digestItemsPerCategory, base.digestItemsPerCategory, 1, 10),
		digestCategoryIds: cats,
		resurfaceEnabled: bool(b.resurfaceEnabled, base.resurfaceEnabled),
		resurfaceAfterMonths: int(b.resurfaceAfterMonths, base.resurfaceAfterMonths, 1, 36),
		quietStart,
		quietEnd,
		timezone: isValidTimeZone(b.timezone) ? b.timezone : base.timezone,
		dailyCap: int(b.dailyCap, base.dailyCap, 1, 20)
	};
}

const SCHEDULE_KEYS = [
	'digestFrequency',
	'digestDayOfWeek',
	'digestDayOfMonth',
	'digestHour',
	'resurfaceEnabled',
	'timezone'
] as const;

/** Saves (validated) prefs. Changing the schedule moves `scheduleChangedAt`, so nothing fires for a slot
 * that was already in the past when the user turned it on. */
export function savePrefs(
	db: DB,
	userId: string,
	input: unknown,
	now = Date.now()
): NotificationPrefs {
	const existing = getStoredPrefs(db, userId);
	const next = normalizePrefs(input, existing ?? DEFAULT_PREFS);
	const changed = !existing || SCHEDULE_KEYS.some((k) => existing[k] !== next[k]);
	const values = {
		userId,
		...next,
		quietStart: parseHm(next.quietStart),
		quietEnd: parseHm(next.quietEnd),
		scheduleChangedAt: changed ? now : existing.scheduleChangedAt,
		updatedAt: now
	};
	db.insert(schema.notificationPrefs)
		.values(values)
		.onConflictDoUpdate({ target: schema.notificationPrefs.userId, set: values })
		.run();
	return next;
}
