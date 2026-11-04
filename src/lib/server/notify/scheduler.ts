// In-process notification scheduler. A tick runs every APP_NOTIFY_TICK_MS (default 5 min), started from
// the `init` hook. Each job is idempotent per user + period (notification_log has a unique key on
// user, kind, period, channel), so restarts and overlapping instances of the same tick never double-send.
// Catch-up: a job only ever looks at its latest due slot, so after downtime it sends that one (late) and
// never a backlog. Single instance only: the state is in SQLite, and two app processes would race.
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb, type DB } from '../db';
import { env } from '../env';
import type { NotifyChannel, NotifyKind } from '../../shared/notifications';
import { rowToPrefs, type StoredPrefs } from './prefs';
import { capReached, deliverableEmail, inQuietHours } from './policy';
import { latestDailySlot, latestDigestSlot, type Slot } from './schedule';
import { buildDigest, selectDigest, type BuiltMessage } from './digest';
import { buildResurface, selectResurface } from './resurface';
import { markSurfaced } from './candidates';
import { emailConfigured, listHeaders, sendEmail } from './email';
import { sendPushToUser, type PushResult } from './push';
import { schema } from '../db';

/** A failed channel is retried on later ticks until this many attempts. */
export const MAX_ATTEMPTS = 3;
/** A 'pending' row older than this was left by a crash mid-send and may be retried. */
const STALE_PENDING_MS = 10 * 60 * 1000;

export interface Senders {
	email(to: string, m: BuiltMessage['email']): Promise<void>;
	push(db: DB, userId: string, payload: BuiltMessage['push'], now: number): Promise<PushResult>;
}
export const defaultSenders: Senders = {
	email: (to, m) => sendEmail({ to, ...m, headers: listHeaders() }),
	push: (db, userId, payload, now) => sendPushToUser(db, userId, payload, now)
};

export interface NotifyUser {
	id: string;
	email: string | null;
	isGuest: boolean;
}

export interface Job {
	kind: Exclude<NotifyKind, 'test'>;
	enabled(p: StoredPrefs): boolean;
	/** latest slot at or before now */
	due(p: StoredPrefs, now: number): Slot | null;
	build(db: DB, u: NotifyUser, p: StoredPrefs, now: number): BuiltMessage | null;
}

export const jobs: Job[] = [
	{
		kind: 'digest',
		enabled: (p) => p.digestFrequency !== 'off',
		due: (p, now) => latestDigestSlot(p, now),
		build: (db, u, p, now) => buildDigest(u.id, selectDigest(db, u.id, p, now), p, now)
	},
	{
		kind: 'resurface',
		enabled: (p) => p.resurfaceEnabled,
		due: (p, now) => latestDailySlot(p, now),
		build: (db, u, p, now) => buildResurface(u.id, selectResurface(db, u.id, p, now), p, now)
	}
];

/** Channels the user can get right now (enabled in prefs and configured / subscribed). */
export function availableChannels(
	db: DB,
	u: NotifyUser,
	p: Pick<StoredPrefs, 'emailEnabled' | 'pushEnabled'>
): NotifyChannel[] {
	const out: NotifyChannel[] = [];
	if (p.emailEnabled && emailConfigured() && deliverableEmail(u.email)) out.push('email');
	if (p.pushEnabled && hasPushSubscription(db, u.id)) out.push('push');
	return out;
}

function hasPushSubscription(db: DB, userId: string) {
	return !!db.sqlite
		.prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1')
		.get(userId);
}

type LogRow = { channel: string; status: string; attempts: number };
const logRows = (db: DB, userId: string, kind: string, periodKey: string) =>
	db.sqlite
		.prepare(
			'SELECT channel, status, attempts FROM notification_log WHERE user_id = ? AND kind = ? AND period_key = ?'
		)
		.all(userId, kind, periodKey) as LogRow[];

/** Claims (user, kind, period, channel) for sending. Returns false if it's already sent or out of tries. */
function claim(
	db: DB,
	userId: string,
	kind: string,
	periodKey: string,
	channel: string,
	now: number
) {
	const ins = db.sqlite
		.prepare(
			`INSERT INTO notification_log (id, user_id, kind, channel, period_key, item_ids, sent_at, status, attempts)
			 VALUES (?, ?, ?, ?, ?, '[]', ?, 'pending', 1) ON CONFLICT DO NOTHING`
		)
		.run(uuidv7(), userId, kind, channel, periodKey, now);
	if (ins.changes) return true;
	const upd = db.sqlite
		.prepare(
			`UPDATE notification_log SET status = 'pending', attempts = attempts + 1, sent_at = ?
			 WHERE user_id = ? AND kind = ? AND period_key = ? AND channel = ? AND attempts < ?
			   AND (status = 'failed' OR (status = 'pending' AND sent_at < ?))`
		)
		.run(now, userId, kind, periodKey, channel, MAX_ATTEMPTS, now - STALE_PENDING_MS);
	return upd.changes > 0;
}

function finish(
	db: DB,
	userId: string,
	kind: string,
	periodKey: string,
	channel: string,
	status: 'sent' | 'failed' | 'empty',
	itemIds: string[],
	now: number,
	error: string | null = null
) {
	db.sqlite
		.prepare(
			`UPDATE notification_log SET status = ?, item_ids = ?, sent_at = ?, error = ?
			 WHERE user_id = ? AND kind = ? AND period_key = ? AND channel = ?`
		)
		.run(status, JSON.stringify(itemIds), now, error, userId, kind, periodKey, channel);
}

export type DeliverOutcome =
	| { status: 'sent'; channels: NotifyChannel[]; failed: NotifyChannel[]; itemIds: string[] }
	| { status: 'failed'; failed: NotifyChannel[]; errors: string[] }
	| { status: 'empty' | 'done' | 'no_channels' | 'quiet' | 'capped' };

/**
 * Sends one notification (kind + period) on every channel that hasn't got it yet.
 * Quiet hours and the daily cap defer (nothing is recorded, a later tick tries again). Tests bypass both.
 */
export async function deliver(opts: {
	db: DB;
	user: NotifyUser;
	prefs: StoredPrefs;
	kind: NotifyKind;
	periodKey: string;
	channels: NotifyChannel[];
	build: () => BuiltMessage | null;
	now: number;
	senders?: Senders;
	bypassPolicy?: boolean;
}): Promise<DeliverOutcome> {
	const { db, user, prefs, kind, periodKey, now } = opts;
	const senders = opts.senders ?? defaultSenders;
	if (user.isGuest) return { status: 'no_channels' };
	const rows = logRows(db, user.id, kind, periodKey);
	if (rows.some((r) => r.channel === 'none')) return { status: 'done' };
	const pending = opts.channels.filter((ch) => {
		const r = rows.find((x) => x.channel === ch);
		return !r || (r.status === 'failed' && r.attempts < MAX_ATTEMPTS) || r.status === 'pending';
	});
	if (!opts.channels.length) return { status: 'no_channels' };
	if (!pending.length) return { status: 'done' };
	const fresh = !rows.some((r) => r.status === 'sent');
	if (!opts.bypassPolicy) {
		if (inQuietHours(prefs, now)) return { status: 'quiet' };
		if (fresh && capReached(db, prefs, now)) return { status: 'capped' };
	}
	const msg = opts.build();
	if (!msg) {
		if (kind !== 'test') {
			db.sqlite
				.prepare(
					`INSERT INTO notification_log (id, user_id, kind, channel, period_key, item_ids, sent_at, status, attempts)
					 VALUES (?, ?, ?, 'none', ?, '[]', ?, 'empty', 1) ON CONFLICT DO NOTHING`
				)
				.run(uuidv7(), user.id, kind, periodKey, now);
		}
		return { status: 'empty' };
	}
	const sent: NotifyChannel[] = [];
	const failed: NotifyChannel[] = [];
	const errors: string[] = [];
	for (const ch of pending) {
		if (!claim(db, user.id, kind, periodKey, ch, now)) continue;
		try {
			if (ch === 'email') {
				await senders.email(user.email!, msg.email);
			} else {
				const r = await senders.push(db, user.id, msg.push, now);
				if (!r.sent) throw new Error(r.errors[0] ?? 'no push subscription accepted the message');
			}
			finish(db, user.id, kind, periodKey, ch, 'sent', msg.itemIds, now);
			sent.push(ch);
		} catch (err) {
			const e = (err instanceof Error ? err.message : String(err)).slice(0, 300);
			finish(db, user.id, kind, periodKey, ch, 'failed', msg.itemIds, now, e);
			failed.push(ch);
			errors.push(`${ch}: ${e}`);
		}
	}
	if (sent.length && kind !== 'test') markSurfaced(db, user.id, msg.itemIds, now);
	if (!sent.length && failed.length) return { status: 'failed', failed, errors };
	if (!sent.length) return { status: 'done' };
	return { status: 'sent', channels: sent, failed, itemIds: msg.itemIds };
}

export interface TickResult {
	users: number;
	sent: number;
	deferred: number;
	failed: number;
}

/** One scheduler pass over every user with something turned on. */
export async function runTick(
	opts: { db?: DB; now?: number; senders?: Senders } = {}
): Promise<TickResult> {
	const db = opts.db ?? getDb();
	const now = opts.now ?? Date.now();
	const rows = db
		.select({
			prefs: schema.notificationPrefs,
			email: schema.user.email,
			isGuest: schema.user.isGuest
		})
		.from(schema.notificationPrefs)
		.innerJoin(schema.user, eq(schema.user.id, schema.notificationPrefs.userId))
		.all();
	const res: TickResult = { users: 0, sent: 0, deferred: 0, failed: 0 };
	for (const r of rows) {
		if (r.isGuest) continue;
		const prefs = rowToPrefs(r.prefs);
		const user: NotifyUser = { id: prefs.userId, email: r.email, isGuest: !!r.isGuest };
		let counted = false;
		for (const job of jobs) {
			if (!job.enabled(prefs)) continue;
			const slot = job.due(prefs, now);
			// Never fire for a slot that was already past when the schedule was set up.
			if (!slot || slot.at < prefs.scheduleChangedAt) continue;
			const channels = availableChannels(db, user, prefs);
			if (!channels.length) continue;
			if (!counted) {
				res.users++;
				counted = true;
			}
			try {
				const out = await deliver({
					db,
					user,
					prefs,
					kind: job.kind,
					periodKey: slot.periodKey,
					channels,
					build: () => job.build(db, user, prefs, now),
					now,
					senders: opts.senders
				});
				if (out.status === 'sent') res.sent++;
				else if (out.status === 'quiet' || out.status === 'capped') res.deferred++;
				else if (out.status === 'failed') {
					res.failed++;
					console.warn(`[notify] ${job.kind} for ${user.id} failed: ${out.errors.join('; ')}`);
				}
			} catch (err) {
				res.failed++;
				console.error(`[notify] ${job.kind} for ${user.id} crashed`, err);
			}
		}
	}
	return res;
}

const g = globalThis as unknown as {
	__appNotifyTimer?: ReturnType<typeof setInterval>;
	__appNotifyBusy?: boolean;
};

async function safeTick() {
	if (g.__appNotifyBusy) return;
	g.__appNotifyBusy = true;
	try {
		const r = await runTick();
		if (r.sent || r.failed)
			console.log(`[notify] tick: ${r.sent} sent, ${r.failed} failed, ${r.deferred} deferred`);
	} catch (err) {
		console.error('[notify] tick failed', err);
	} finally {
		g.__appNotifyBusy = false;
	}
}

/** Starts the interval (idempotent across dev hot reloads). The first tick runs shortly after startup. */
export function startScheduler(intervalMs = env.notifyTickMs) {
	if (g.__appNotifyTimer) clearInterval(g.__appNotifyTimer);
	if (!intervalMs || intervalMs < 0) return;
	g.__appNotifyTimer = setInterval(safeTick, Math.max(10_000, intervalMs));
	g.__appNotifyTimer.unref?.();
	setTimeout(safeTick, 15_000).unref?.();
}
