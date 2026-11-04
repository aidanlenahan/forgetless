// Web Push channel (web-push). VAPID keys come from APP_VAPID_* or are generated once and stored in
// app_settings, so push works on a fresh self-hosted instance with no config.
import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { schema, type DB } from '../db';
import { env } from '../env';
import type { PushPayload, PushSubscriptionInfo } from '../../shared/notifications';

export interface VapidKeys {
	publicKey: string;
	privateKey: string;
	subject: string;
}

const VAPID_KEY = 'vapid';
const g = globalThis as unknown as { __appVapid?: { db: DB; keys: VapidKeys } };

function defaultSubject(): string {
	if (env.vapid.subject) return env.vapid.subject;
	try {
		const u = new URL(env.origin);
		if (u.protocol === 'https:' && u.hostname !== 'localhost') return u.origin;
		const from = /<([^>]+)>/.exec(env.smtpFrom)?.[1] ?? env.smtpFrom;
		if (/^[^@\s]+@[^@\s]+$/.test(from)) return `mailto:${from}`;
		return `mailto:no-reply@${u.hostname || 'localhost'}`;
	} catch {
		return 'mailto:no-reply@localhost';
	}
}

/** The instance's VAPID key pair (env first, then the stored one, generating it on first use). */
export function vapidKeys(db: DB): VapidKeys {
	if (env.vapid.publicKey && env.vapid.privateKey)
		return {
			publicKey: env.vapid.publicKey,
			privateKey: env.vapid.privateKey,
			subject: defaultSubject()
		};
	if (g.__appVapid?.db === db) return g.__appVapid.keys;
	const row = db
		.select()
		.from(schema.appSettings)
		.where(eq(schema.appSettings.key, VAPID_KEY))
		.get();
	let stored = row?.value as { publicKey?: string; privateKey?: string } | undefined;
	if (!stored?.publicKey || !stored.privateKey) {
		const k = webpush.generateVAPIDKeys();
		stored = { publicKey: k.publicKey, privateKey: k.privateKey };
		// Another request may have raced us: keep whichever row landed first.
		db.insert(schema.appSettings)
			.values({ key: VAPID_KEY, value: stored, updatedAt: Date.now() })
			.onConflictDoNothing()
			.run();
		stored = db
			.select()
			.from(schema.appSettings)
			.where(eq(schema.appSettings.key, VAPID_KEY))
			.get()!.value as { publicKey: string; privateKey: string };
	}
	const keys = {
		publicKey: stored.publicKey!,
		privateKey: stored.privateKey!,
		subject: defaultSubject()
	};
	g.__appVapid = { db, keys };
	return keys;
}

// ---------- subscriptions ----------

type SubRow = typeof schema.pushSubscriptions.$inferSelect;
const toInfo = (r: SubRow): PushSubscriptionInfo => ({
	id: r.id,
	endpoint: r.endpoint,
	userAgent: r.userAgent,
	createdAt: r.createdAt,
	lastSuccessAt: r.lastSuccessAt,
	failureCount: r.failureCount
});

export interface SubscriptionInput {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

export function parseSubscription(v: unknown): SubscriptionInput | null {
	const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
	if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 2000) return null;
	try {
		if (new URL(s.endpoint).protocol !== 'https:') return null;
	} catch {
		return null;
	}
	const p256dh = s.keys?.p256dh;
	const auth = s.keys?.auth;
	if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
	if (p256dh.length > 200 || auth.length > 100) return null;
	return { endpoint: s.endpoint, keys: { p256dh, auth } };
}

/** Upserts by endpoint. A browser's endpoint moves to whoever subscribed last on that device. */
export function saveSubscription(
	db: DB,
	userId: string,
	sub: SubscriptionInput,
	userAgent: string | null,
	now = Date.now()
): PushSubscriptionInfo {
	const values = {
		id: uuidv7(),
		userId,
		endpoint: sub.endpoint,
		keys: sub.keys,
		userAgent: userAgent?.slice(0, 300) ?? null,
		createdAt: now,
		lastSuccessAt: null,
		failureCount: 0
	};
	db.insert(schema.pushSubscriptions)
		.values(values)
		.onConflictDoUpdate({
			target: schema.pushSubscriptions.endpoint,
			set: { userId, keys: sub.keys, userAgent: values.userAgent, failureCount: 0 }
		})
		.run();
	return toInfo(
		db
			.select()
			.from(schema.pushSubscriptions)
			.where(eq(schema.pushSubscriptions.endpoint, sub.endpoint))
			.get()!
	);
}

export function deleteSubscription(db: DB, userId: string, endpoint: string): boolean {
	const r = db
		.delete(schema.pushSubscriptions)
		.where(
			and(
				eq(schema.pushSubscriptions.userId, userId),
				eq(schema.pushSubscriptions.endpoint, endpoint)
			)
		)
		.run();
	return r.changes > 0;
}

export function listSubscriptions(db: DB, userId: string): PushSubscriptionInfo[] {
	return db
		.select()
		.from(schema.pushSubscriptions)
		.where(eq(schema.pushSubscriptions.userId, userId))
		.all()
		.map(toInfo);
}

// ---------- sending ----------

/** A subscription that keeps failing (but isn't 404/410) is dropped after this many failures in a row. */
export const MAX_PUSH_FAILURES = 5;

export interface PushResult {
	sent: number;
	failed: number;
	pruned: number;
	errors: string[];
}

/** Sends `payload` to every subscription of the user. Prunes gone (404/410) subscriptions. */
export async function sendPushToUser(
	db: DB,
	userId: string,
	payload: PushPayload,
	now = Date.now()
): Promise<PushResult> {
	const subs = db
		.select()
		.from(schema.pushSubscriptions)
		.where(eq(schema.pushSubscriptions.userId, userId))
		.all();
	const res: PushResult = { sent: 0, failed: 0, pruned: 0, errors: [] };
	if (!subs.length) return res;
	const vapid = vapidKeys(db);
	const body = JSON.stringify(payload);
	const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;
	for (const s of subs) {
		try {
			await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
				vapidDetails: vapid,
				TTL: 24 * 60 * 60,
				urgency: 'normal',
				// Same topic replaces an undelivered older message of the same kind on the push service.
				topic: payload.kind,
				// Hosts whose egress goes through an HTTP(S) proxy.
				...(proxy ? { proxy } : {})
			});
			db.update(schema.pushSubscriptions)
				.set({ lastSuccessAt: now, failureCount: 0 })
				.where(eq(schema.pushSubscriptions.id, s.id))
				.run();
			res.sent++;
		} catch (err) {
			const status = (err as { statusCode?: number }).statusCode;
			res.failed++;
			res.errors.push(`${status ?? 'error'}: ${(err as Error).message ?? err}`.slice(0, 200));
			if (status === 404 || status === 410 || s.failureCount + 1 >= MAX_PUSH_FAILURES) {
				db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id)).run();
				res.pruned++;
			} else {
				db.update(schema.pushSubscriptions)
					.set({ failureCount: s.failureCount + 1 })
					.where(eq(schema.pushSubscriptions.id, s.id))
					.run();
			}
		}
	}
	return res;
}
