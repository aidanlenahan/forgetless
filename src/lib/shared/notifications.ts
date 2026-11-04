// Notification settings and API shapes shared by the server (src/lib/server/notify) and the settings UI.

export type DigestFrequency = 'off' | 'weekly' | 'monthly';
export type NotifyKind = 'digest' | 'resurface' | 'test';
export type NotifyChannel = 'email' | 'push';
export type ItemAction = 'keep' | 'drop' | 'snooze';

/** GET/PUT /api/notifications/prefs body. Times are local to `timezone`. */
export interface NotificationPrefs {
	emailEnabled: boolean;
	pushEnabled: boolean;
	digestFrequency: DigestFrequency;
	/** 0 = Sunday … 6 = Saturday */
	digestDayOfWeek: number;
	/** 1–31 (clamped to the month's length) */
	digestDayOfMonth: number;
	/** 0–23: digests and resurface reminders go out at this local hour */
	digestHour: number;
	digestItemsPerCategory: number;
	/** null = all lists */
	digestCategoryIds: string[] | null;
	resurfaceEnabled: boolean;
	resurfaceAfterMonths: number;
	/** "HH:MM"; both null = no quiet hours */
	quietStart: string | null;
	quietEnd: string | null;
	timezone: string;
	/** max scheduled notifications per local day */
	dailyCap: number;
}

export const DEFAULT_PREFS: NotificationPrefs = {
	emailEnabled: true,
	pushEnabled: false,
	digestFrequency: 'off',
	digestDayOfWeek: 0,
	digestDayOfMonth: 1,
	digestHour: 9,
	digestItemsPerCategory: 3,
	digestCategoryIds: null,
	resurfaceEnabled: false,
	resurfaceAfterMonths: 6,
	quietStart: '22:00',
	quietEnd: '08:00',
	timezone: 'UTC',
	dailyCap: 3
};

export interface PushSubscriptionInfo {
	id: string;
	endpoint: string;
	userAgent: string | null;
	createdAt: number;
	lastSuccessAt: number | null;
	failureCount: number;
}

export interface PrefsResponse {
	prefs: NotificationPrefs;
	/** false until the user saves settings once */
	saved: boolean;
	email: string | null;
	channels: { email: boolean; push: boolean };
	subscriptions: PushSubscriptionInfo[];
}

export interface PreviewItem {
	id: string;
	title: string;
	categoryId: string;
	categoryName: string;
	categoryIcon: string;
	ageDays: number;
	score: number;
}
export interface PreviewResponse {
	kind: 'digest' | 'resurface';
	empty: boolean;
	subject: string;
	items: PreviewItem[];
	/** when the next scheduled one would go out (null when off) */
	nextAt: number | null;
}

/** JSON payload of a Web Push message (read by src/sw.ts). Kept small: push services cap ~4 KB. */
export interface PushPayload {
	title: string;
	body: string;
	kind: NotifyKind;
	/** notifications with the same tag replace each other */
	tag: string;
	/** opened when the notification is tapped */
	url: string;
	/** keep / drop / snooze buttons for one item (resurface) */
	actions?: { action: ItemAction; title: string; url: string }[];
}

/** "HH:MM" -> minutes after midnight, or null. */
export function parseHm(v: unknown): number | null {
	if (typeof v !== 'string') return null;
	const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return h * 60 + min;
}
export function formatHm(minutes: number | null): string | null {
	if (minutes == null) return null;
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
