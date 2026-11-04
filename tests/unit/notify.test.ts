import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// web-push is mocked: the push tests decide what the "push service" answers.
const sendNotification = vi.fn();
vi.mock('web-push', () => ({
	default: {
		sendNotification: (...a: unknown[]) => sendNotification(...a),
		generateVAPIDKeys: () => ({ publicKey: 'BPUBLICKEY', privateKey: 'PRIVATEKEY' })
	}
}));

import type { DB } from '../../src/lib/server/db';
import { applyMutations } from '../../src/lib/server/repo';
import { env } from '../../src/lib/server/env';
import { savePrefs, getStoredPrefs, normalizePrefs } from '../../src/lib/server/notify/prefs';
import { selectDigest, buildDigest, digestScore } from '../../src/lib/server/notify/digest';
import { selectResurface, buildResurface } from '../../src/lib/server/notify/resurface';
import { markSurfaced, loadCandidates } from '../../src/lib/server/notify/candidates';
import { snoozeItem, applyAction } from '../../src/lib/server/notify/actions';
import { inQuietHours, capReached, sentToday } from '../../src/lib/server/notify/policy';
import {
	latestDigestSlot,
	nextDigestSlot,
	latestDailySlot
} from '../../src/lib/server/notify/schedule';
import { localParts, zonedToUtc } from '../../src/lib/server/notify/time';
import { runTick, deliver, type Senders } from '../../src/lib/server/notify/scheduler';
import { signAction, verifyAction } from '../../src/lib/server/notify/tokens';
import { renderEmail, setMailTransport } from '../../src/lib/server/notify/email';
import {
	saveSubscription,
	sendPushToUser,
	listSubscriptions,
	vapidKeys
} from '../../src/lib/server/notify/push';
import { DEFAULT_PREFS, type PushPayload } from '../../src/lib/shared/notifications';
import { makeDb, addUser, cat, item, log } from './helpers';

const DAY = 86_400_000;
// Sunday 8 Nov 2026, 12:00 UTC
const NOW = Date.UTC(2026, 10, 8, 12, 0);

let db: DB;
let u: string;
beforeEach(() => {
	db = makeDb();
	u = addUser(db);
	sendNotification.mockReset();
});
afterEach(() => {
	env.smtpUrl = '';
	setMailTransport(null);
});

function seed(rows: Parameters<typeof applyMutations>[1]) {
	applyMutations(u, rows, db);
}
const ago = (days: number) => NOW - days * DAY;

describe('digest selection', () => {
	it('picks N want items per list, oldest (highest age × (1 + priority)) first', () => {
		const watch = cat({ name: 'Watch', sort: 0 });
		const read = cat({ name: 'Read', sort: 1 });
		const items = [
			item(watch.id, { title: 'w-10', createdAt: ago(10), updatedAt: ago(10) }),
			item(watch.id, { title: 'w-300', createdAt: ago(300), updatedAt: ago(300) }),
			item(watch.id, { title: 'w-50', createdAt: ago(50), updatedAt: ago(50) }),
			item(watch.id, { title: 'w-done', status: 'done', createdAt: ago(900), updatedAt: ago(1) }),
			item(watch.id, { title: 'w-del', createdAt: ago(800), updatedAt: ago(1), deletedAt: ago(1) }),
			item(read.id, { title: 'r-5', createdAt: ago(5), updatedAt: ago(5) })
		];
		seed([
			{ kind: 'category', row: watch },
			{ kind: 'category', row: read },
			...items.map((row) => ({ kind: 'item' as const, row }))
		]);
		const groups = selectDigest(db, u, { digestCategoryIds: null, digestItemsPerCategory: 2 }, NOW);
		expect(groups.map((g) => g.categoryName)).toEqual(['Watch', 'Read']);
		expect(groups[0].items.map((i) => i.title)).toEqual(['w-300', 'w-50']);
		expect(groups[0].items[0].score).toBeCloseTo(300);
		expect(groups[1].items.map((i) => i.title)).toEqual(['r-5']);

		// category scope
		const only = selectDigest(
			db,
			u,
			{ digestCategoryIds: [read.id], digestItemsPerCategory: 3 },
			NOW
		);
		expect(only.map((g) => g.categoryName)).toEqual(['Read']);
		expect(selectDigest(db, u, { digestCategoryIds: [], digestItemsPerCategory: 3 }, NOW)).toEqual(
			[]
		);
	});

	it('scores age × (1 + priority) with priority 0 for now', () => {
		const c = cat();
		const it = item(c.id, { createdAt: ago(40) });
		seed([
			{ kind: 'category', row: c },
			{ kind: 'item', row: it }
		]);
		const [cand] = loadCandidates(db, u, NOW, null);
		expect(digestScore(cand, NOW)).toBeCloseTo(40);
	});

	it('skips items surfaced in the last 30 days, and snoozed ones', () => {
		const c = cat();
		const a = item(c.id, { title: 'A', createdAt: ago(100) });
		const b = item(c.id, { title: 'B', createdAt: ago(90) });
		const s = item(c.id, { title: 'S', createdAt: ago(80) });
		seed([
			{ kind: 'category', row: c },
			...[a, b, s].map((row) => ({ kind: 'item' as const, row }))
		]);
		markSurfaced(db, u, [a.id], ago(29));
		markSurfaced(db, u, [b.id], ago(31));
		snoozeItem(db, u, s.id, NOW + DAY);
		const titles = () =>
			selectDigest(db, u, { digestCategoryIds: null, digestItemsPerCategory: 5 }, NOW).flatMap(
				(g) => g.items.map((i) => i.title)
			);
		expect(titles()).toEqual(['B']);
		snoozeItem(db, u, s.id, NOW - 1); // expired snooze
		expect(titles()).toEqual(['B', 'S']);
	});

	it('builds nothing for an empty digest', () => {
		expect(buildDigest(u, [], { ...DEFAULT_PREFS, digestFrequency: 'weekly' }, NOW)).toBeNull();
	});
});

describe('resurface eligibility', () => {
	it('finds want items older than N months, untouched and unlogged since, up to 3', () => {
		const c = cat();
		const old1 = item(c.id, { title: 'old1', createdAt: ago(400), updatedAt: ago(400) });
		const old2 = item(c.id, { title: 'old2', createdAt: ago(300), updatedAt: ago(250) });
		const old3 = item(c.id, { title: 'old3', createdAt: ago(240), updatedAt: ago(240) });
		const old4 = item(c.id, { title: 'old4', createdAt: ago(200), updatedAt: ago(200) });
		const edited = item(c.id, { title: 'edited', createdAt: ago(400), updatedAt: ago(20) });
		const logged = item(c.id, { title: 'logged', createdAt: ago(400), updatedAt: ago(400) });
		const young = item(c.id, { title: 'young', createdAt: ago(60), updatedAt: ago(60) });
		const done = item(c.id, {
			title: 'done',
			status: 'done',
			createdAt: ago(400),
			updatedAt: ago(400)
		});
		seed([
			{ kind: 'category', row: c },
			...[old1, old2, old3, old4, edited, logged, young, done].map((row) => ({
				kind: 'item' as const,
				row
			})),
			{ kind: 'logEntry', row: log(logged.id, { createdAt: ago(10), updatedAt: ago(10) }) }
		]);
		const pick = () =>
			selectResurface(db, u, { resurfaceAfterMonths: 6, digestCategoryIds: null }, NOW).map(
				(i) => i.title
			);
		expect(pick()).toEqual(['old1', 'old2', 'old3']);
		snoozeItem(db, u, old1.id, NOW + 10 * DAY);
		markSurfaced(db, u, [old2.id], ago(3));
		expect(pick()).toEqual(['old3', 'old4']);

		const msg = buildResurface(
			u,
			selectResurface(db, u, { resurfaceAfterMonths: 6, digestCategoryIds: null }, NOW),
			{ resurfaceAfterMonths: 6 },
			NOW
		)!;
		expect(msg.push.actions?.map((a) => a.action)).toEqual(['keep', 'snooze', 'drop']);
		expect(msg.email.text).toContain('Keep: ');
		expect(msg.email.text).toContain('Snooze 1 month: ');
	});
});

describe('quiet hours and the daily cap', () => {
	const tz = 'America/New_York';
	it('handles a window across midnight in the user time zone', () => {
		const p = { quietStart: '22:00', quietEnd: '07:00', timezone: tz };
		// 8 Nov 2026 in New York is EST (UTC-5)
		expect(inQuietHours(p, Date.UTC(2026, 10, 9, 3, 30))).toBe(true); // 22:30 local
		expect(inQuietHours(p, Date.UTC(2026, 10, 9, 11, 0))).toBe(true); // 06:00 local
		expect(inQuietHours(p, Date.UTC(2026, 10, 9, 12, 0))).toBe(false); // 07:00 local
		expect(inQuietHours(p, Date.UTC(2026, 10, 9, 2, 59))).toBe(false); // 21:59 local
		expect(inQuietHours({ ...p, timezone: 'UTC' }, Date.UTC(2026, 10, 9, 3, 30))).toBe(true);
		expect(inQuietHours({ ...p, timezone: 'UTC' }, Date.UTC(2026, 10, 9, 11, 0))).toBe(false);
	});
	it('handles a same-day window and no window', () => {
		const p = { quietStart: '13:00', quietEnd: '14:00', timezone: 'Asia/Tokyo' };
		expect(inQuietHours(p, Date.UTC(2026, 10, 9, 4, 30))).toBe(true); // 13:30 JST
		expect(inQuietHours(p, Date.UTC(2026, 10, 9, 5, 0))).toBe(false); // 14:00 JST
		expect(inQuietHours({ quietStart: null, quietEnd: null, timezone: tz }, NOW)).toBe(false);
	});
	it('counts distinct notifications sent today (local), excluding tests', () => {
		const insert = (
			kind: string,
			period: string,
			channel: string,
			sentAt: number,
			status = 'sent'
		) =>
			db.sqlite
				.prepare(
					`INSERT INTO notification_log (id, user_id, kind, channel, period_key, item_ids, sent_at, status)
					 VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`
				)
				.run(`${kind}${period}${channel}`, u, kind, channel, period, sentAt, status);
		insert('digest', 'p1', 'email', NOW - 60_000);
		insert('digest', 'p1', 'push', NOW - 60_000); // same notification, other channel
		insert('resurface', 'p2', 'email', NOW - 120_000, 'failed');
		insert('test', 't1', 'email', NOW - 60_000);
		insert('resurface', 'p0', 'email', NOW - 2 * DAY);
		expect(sentToday(db, u, 'UTC', NOW)).toBe(1);
		expect(capReached(db, { userId: u, timezone: 'UTC', dailyCap: 1 }, NOW)).toBe(true);
		expect(capReached(db, { userId: u, timezone: 'UTC', dailyCap: 2 }, NOW)).toBe(false);
	});
});

describe('schedule', () => {
	it('converts local wall time to UTC across DST', () => {
		expect(zonedToUtc(2026, 7, 1, 9, 0, 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 13, 0));
		expect(zonedToUtc(2026, 12, 1, 9, 0, 'America/New_York')).toBe(Date.UTC(2026, 11, 1, 14, 0));
		expect(localParts(Date.UTC(2026, 10, 8, 12), 'Asia/Kolkata')).toMatchObject({
			hour: 17,
			minute: 30,
			weekday: 0
		});
	});
	it('finds the latest and next weekly / monthly slot', () => {
		const p = {
			...DEFAULT_PREFS,
			digestFrequency: 'weekly' as const,
			digestDayOfWeek: 0,
			digestHour: 9,
			timezone: 'UTC'
		};
		expect(latestDigestSlot(p, NOW)).toEqual({
			periodKey: '2026-11-08',
			at: Date.UTC(2026, 10, 8, 9)
		});
		expect(latestDigestSlot(p, Date.UTC(2026, 10, 8, 8))?.periodKey).toBe('2026-11-01');
		expect(nextDigestSlot(p, NOW)?.periodKey).toBe('2026-11-15');
		const m = { ...p, digestFrequency: 'monthly' as const, digestDayOfMonth: 31 };
		expect(latestDigestSlot(m, NOW)?.periodKey).toBe('2026-10-31');
		expect(nextDigestSlot(m, NOW)?.periodKey).toBe('2026-11-30'); // clamped
		expect(latestDailySlot({ digestHour: 13, timezone: 'UTC' }, NOW).periodKey).toBe('2026-11-07');
	});
});

describe('scheduler', () => {
	function fakeSenders() {
		const email: { to: string; subject: string }[] = [];
		const push: PushPayload[] = [];
		const senders: Senders = {
			email: async (to, m) => void email.push({ to, subject: m.subject }),
			push: async (_db, _u, p) => (push.push(p), { sent: 1, failed: 0, pruned: 0, errors: [] })
		};
		return { email, push, senders };
	}
	function setup() {
		env.smtpUrl = 'smtp://test.invalid:25';
		const c = cat();
		const items = [0, 1, 2, 3].map((i) =>
			item(c.id, { title: `t${i}`, createdAt: ago(200 + i), updatedAt: ago(200 + i) })
		);
		seed([{ kind: 'category', row: c }, ...items.map((row) => ({ kind: 'item' as const, row }))]);
		// schedule set up a month ago
		savePrefs(
			db,
			u,
			{
				digestFrequency: 'weekly',
				digestDayOfWeek: 0,
				digestHour: 9,
				timezone: 'UTC',
				quietStart: null,
				quietEnd: null
			},
			ago(30)
		);
		return items;
	}

	it('sends the due digest once per period (idempotent across ticks and restarts)', async () => {
		setup();
		const f = fakeSenders();
		const r1 = await runTick({ db, now: NOW, senders: f.senders });
		expect(r1.sent).toBe(1);
		await runTick({ db, now: NOW + 5 * 60_000, senders: f.senders });
		await runTick({ db, now: NOW + DAY, senders: f.senders });
		expect(f.email).toHaveLength(1);
		expect(f.email[0].subject).toMatch(/weekly .* digest: 3 things/);
		const rows = db.sqlite
			.prepare('SELECT kind, channel, period_key, status FROM notification_log')
			.all();
		expect(rows).toEqual([
			{ kind: 'digest', channel: 'email', period_key: '2026-11-08', status: 'sent' }
		]);
		// next week: the 3 surfaced items are in cooldown, so only the 4th one goes out
		await runTick({ db, now: NOW + 7 * DAY, senders: f.senders });
		expect(f.email).toHaveLength(2);
		expect(f.email[1].subject).toMatch(/1 thing to try/);
	});

	it('catches up after downtime with only the latest due digest', async () => {
		setup();
		const f = fakeSenders();
		// server was down for three weeks; comes back on a Wednesday
		await runTick({ db, now: NOW + 24 * DAY, senders: f.senders });
		await runTick({ db, now: NOW + 24 * DAY + 300_000, senders: f.senders });
		expect(f.email).toHaveLength(1);
		const keys = db.sqlite.prepare('SELECT period_key FROM notification_log').all();
		expect(keys).toEqual([{ period_key: '2026-11-29' }]);
	});

	it('does not fire for a slot that was already past when the schedule was saved', async () => {
		setup();
		savePrefs(db, u, { digestDayOfWeek: 0, digestHour: 10 }, NOW); // changed at 12:00, slot 10:00
		const f = fakeSenders();
		await runTick({ db, now: NOW + 60_000, senders: f.senders });
		expect(f.email).toHaveLength(0);
		await runTick({ db, now: NOW + 7 * DAY, senders: f.senders });
		expect(f.email).toHaveLength(1);
	});

	it('defers during quiet hours and over the cap, then sends', async () => {
		setup();
		savePrefs(db, u, { quietStart: '11:00', quietEnd: '13:00' }, ago(30));
		const f = fakeSenders();
		expect((await runTick({ db, now: NOW, senders: f.senders })).deferred).toBe(1);
		expect(f.email).toHaveLength(0);
		await runTick({ db, now: NOW + 61 * 60_000, senders: f.senders }); // 13:01
		expect(f.email).toHaveLength(1);

		// cap: a resurface reminder due the same day waits for tomorrow
		savePrefs(db, u, { resurfaceEnabled: true, dailyCap: 1, digestHour: 9 }, ago(30));
		db.sqlite.prepare('UPDATE notification_prefs SET schedule_changed_at = ?').run(ago(30));
		const r = await runTick({ db, now: NOW + 2 * 60 * 60_000, senders: f.senders });
		expect(r.deferred).toBe(1);
		expect(f.email).toHaveLength(1);
		await runTick({ db, now: NOW + DAY - 60 * 60_000, senders: f.senders }); // Mon 11:00 (quiet)
		await runTick({ db, now: NOW + DAY + 2 * 60 * 60_000, senders: f.senders }); // Mon 14:00
		expect(f.email).toHaveLength(2);
		expect(f.email[1].subject).toMatch(/^Still want to try “t0”\?/);
	});

	it('retries a failed channel on the next tick, up to 3 attempts', async () => {
		setup();
		let fail = 2;
		const sent: string[] = [];
		const senders: Senders = {
			email: async (_to, m) => {
				if (fail-- > 0) throw new Error('SMTP down');
				sent.push(m.subject);
			},
			push: async () => ({ sent: 0, failed: 0, pruned: 0, errors: [] })
		};
		await runTick({ db, now: NOW, senders });
		await runTick({ db, now: NOW + 300_000, senders });
		await runTick({ db, now: NOW + 600_000, senders });
		await runTick({ db, now: NOW + 900_000, senders });
		expect(sent).toHaveLength(1);
		const row = db.sqlite.prepare('SELECT status, attempts FROM notification_log').get();
		expect(row).toEqual({ status: 'sent', attempts: 3 });
	});

	it('never notifies guests', async () => {
		env.smtpUrl = 'smtp://test.invalid:25';
		const g = addUser(db, undefined, { guest: true, guestExpiresAt: NOW + DAY });
		const c = cat();
		applyMutations(
			g,
			[
				{ kind: 'category', row: c },
				{ kind: 'item', row: item(c.id, { createdAt: ago(300) }) }
			],
			db
		);
		savePrefs(db, g, { digestFrequency: 'weekly', resurfaceEnabled: true }, ago(30));
		const f = fakeSenders();
		expect((await runTick({ db, now: NOW, senders: f.senders })).sent).toBe(0);
		expect(f.email).toHaveLength(0);
		const out = await deliver({
			db,
			user: { id: g, email: 'x@y.z', isGuest: true },
			prefs: getStoredPrefs(db, g)!,
			kind: 'test',
			periodKey: 't',
			channels: ['email'],
			build: () => null,
			now: NOW,
			senders: f.senders,
			bypassPolicy: true
		});
		expect(out.status).toBe('no_channels');
	});
});

describe('prefs validation', () => {
	it('clamps values and rejects bad time zones', () => {
		const p = normalizePrefs(
			{
				digestItemsPerCategory: 99,
				digestHour: -3,
				timezone: 'Mars/Olympus',
				quietStart: '23:00',
				quietEnd: 'nope',
				digestFrequency: 'daily'
			},
			DEFAULT_PREFS
		);
		expect(p.digestItemsPerCategory).toBe(10);
		expect(p.digestHour).toBe(0);
		expect(p.timezone).toBe('UTC');
		expect(p.quietStart).toBeNull();
		expect(p.digestFrequency).toBe('off');
	});
});

describe('action tokens', () => {
	const secret = 'test-secret-test-secret-test-secret!!';
	it('round-trips, expires and rejects tampering', () => {
		const t = signAction({ userId: 'u1', itemId: 'item-1234', action: 'drop' }, NOW, secret);
		const v = verifyAction(t, NOW + DAY, secret);
		expect(v).toEqual({
			ok: true,
			claims: { userId: 'u1', itemId: 'item-1234', action: 'drop', exp: expect.any(Number) }
		});
		expect(verifyAction(t, NOW + 31 * DAY, secret)).toEqual({ ok: false, reason: 'expired' });
		expect(verifyAction(t, NOW, 'another-secret-another-secret-xx')).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
		const [payload, sig] = t.split('.');
		const forged = Buffer.from(
			JSON.stringify({ u: 'u1', i: 'item-1234', a: 'keep', e: 9e9 })
		).toString('base64url');
		expect(verifyAction(`${forged}.${sig}`, NOW, secret).ok).toBe(false);
		expect(verifyAction(`${payload}.${sig.slice(0, -2)}xx`, NOW, secret).ok).toBe(false);
		expect(verifyAction('garbage', NOW, secret)).toEqual({ ok: false, reason: 'malformed' });
	});
});

describe('applyAction', () => {
	it('keeps, drops and snoozes through applyMutations', () => {
		const c = cat();
		const it = item(c.id, { createdAt: ago(300), updatedAt: ago(300) });
		seed([
			{ kind: 'category', row: c },
			{ kind: 'item', row: it }
		]);
		const exp = NOW + DAY;
		const get = () =>
			db.sqlite
				.prepare('SELECT status, updated_at AS updatedAt FROM items WHERE id = ?')
				.get(it.id) as { status: string; updatedAt: number };

		expect(applyAction(db, { userId: u, itemId: it.id, action: 'snooze', exp }, NOW)).toMatchObject(
			{ ok: true, until: NOW + 30 * DAY }
		);
		expect(loadCandidates(db, u, NOW, null)).toHaveLength(0);

		applyAction(db, { userId: u, itemId: it.id, action: 'keep', exp }, NOW);
		expect(get()).toEqual({ status: 'want', updatedAt: NOW });
		expect(loadCandidates(db, u, NOW, null)).toHaveLength(1); // keep clears the snooze
		expect(
			selectResurface(db, u, { resurfaceAfterMonths: 6, digestCategoryIds: null }, NOW)
		).toHaveLength(0);

		applyAction(db, { userId: u, itemId: it.id, action: 'drop', exp }, NOW + 1000);
		expect(get().status).toBe('dropped');
		// another user's token can't touch it
		const other = addUser(db);
		expect(applyAction(db, { userId: other, itemId: it.id, action: 'keep', exp }, NOW)).toEqual({
			ok: false,
			reason: 'not_found'
		});
	});
});

describe('/a/[token] route', () => {
	it('GET only confirms; POST applies the action without a session', async () => {
		const { getDb } = await import('../../src/lib/server/db');
		const gdb = getDb();
		const uid = addUser(gdb);
		const c = cat();
		const it = item(c.id, { title: 'Arrival' });
		applyMutations(
			uid,
			[
				{ kind: 'category', row: c },
				{ kind: 'item', row: it }
			],
			gdb
		);
		const { GET, POST } = await import('../../src/routes/a/[token]/+server');
		const event = (token: string, contentType?: string) =>
			({
				params: { token },
				getClientAddress: () => '127.0.0.1',
				request: new Request('http://x/a/' + token, {
					method: contentType ? 'POST' : 'GET',
					headers: contentType ? { 'content-type': contentType } : {}
				})
			}) as never;
		const status = () =>
			(gdb.sqlite.prepare('SELECT status FROM items WHERE id = ?').get(it.id) as { status: string })
				.status;

		const dropToken = signAction({ userId: uid, itemId: it.id, action: 'drop' });
		const res = (await GET(event(dropToken))) as Response;
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const html = await res.text();
		expect(html).toContain('Drop “Arrival”?');
		expect(html).toContain('<form method="post">');
		expect(status()).toBe('want'); // a link scanner opening the URL changes nothing

		const form = (await POST(event(dropToken, 'application/x-www-form-urlencoded'))) as Response;
		expect(form.headers.get('content-type')).toContain('text/html');
		expect(await form.text()).toContain('Dropped “Arrival”');
		expect(
			(gdb.sqlite.prepare('SELECT status FROM items WHERE id = ?').get(it.id) as { status: string })
				.status
		).toBe('dropped');

		const post = (await POST(
			event(signAction({ userId: uid, itemId: it.id, action: 'keep' }))
		)) as Response;
		expect(await post.json()).toMatchObject({ ok: true, action: 'keep' });
		expect(
			(gdb.sqlite.prepare('SELECT status FROM items WHERE id = ?').get(it.id) as { status: string })
				.status
		).toBe('want');

		const bad = (await GET(event('abc.def'))) as Response;
		expect(bad.status).toBe(400);
		const expired = (await GET(
			event(signAction({ userId: uid, itemId: it.id, action: 'keep', exp: Date.now() - 1000 }))
		)) as Response;
		expect(expired.status).toBe(410);
	});
});

describe('push', () => {
	const sub = (n: number) => ({
		endpoint: `https://push.example/${n}`,
		keys: { p256dh: 'p', auth: 'a' }
	});
	it('prunes subscriptions on 404/410 and counts other failures', async () => {
		saveSubscription(db, u, sub(1), 'UA1', NOW);
		saveSubscription(db, u, sub(2), 'UA2', NOW);
		saveSubscription(db, u, sub(3), 'UA3', NOW);
		sendNotification.mockImplementation(async (s: { endpoint: string }) => {
			if (s.endpoint.endsWith('/1')) return { statusCode: 201 };
			const e = Object.assign(new Error('push failed'), {
				statusCode: s.endpoint.endsWith('/2') ? 410 : 500
			});
			throw e;
		});
		const r = await sendPushToUser(
			db,
			u,
			{ title: 't', body: 'b', kind: 'test', tag: 'test', url: '/' },
			NOW
		);
		expect(r).toMatchObject({ sent: 1, failed: 2, pruned: 1 });
		const left = listSubscriptions(db, u);
		expect(left.map((s) => s.endpoint).sort()).toEqual([
			'https://push.example/1',
			'https://push.example/3'
		]);
		expect(left.find((s) => s.endpoint.endsWith('/1'))?.lastSuccessAt).toBe(NOW);
		expect(left.find((s) => s.endpoint.endsWith('/3'))?.failureCount).toBe(1);
		const [, body, opts] = sendNotification.mock.calls[0];
		expect(JSON.parse(body as string)).toMatchObject({ title: 't', url: '/' });
		expect((opts as { vapidDetails: { publicKey: string } }).vapidDetails.publicKey).toBe(
			'BPUBLICKEY'
		);
	});
	it('generates VAPID keys once and keeps them in the DB', () => {
		const a = vapidKeys(db);
		const b = vapidKeys(db);
		expect(a.publicKey).toBe('BPUBLICKEY');
		expect(b).toEqual(a);
		expect(a.subject).toMatch(/^mailto:|^https:/);
		expect(
			db.sqlite.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key = 'vapid'").get()
		).toEqual({ n: 1 });
	});
	it('moves an endpoint to whoever subscribed last', () => {
		const other = addUser(db);
		saveSubscription(db, u, sub(9), null, NOW);
		saveSubscription(db, other, sub(9), null, NOW);
		expect(listSubscriptions(db, u)).toHaveLength(0);
		expect(listSubscriptions(db, other)).toHaveLength(1);
	});
});

describe('email', () => {
	it('renders text + HTML with the palette, escaping and a manage link', () => {
		const m = renderEmail({
			subject: 'Hi',
			preheader: 'pre',
			heading: 'A few things <you> wanted',
			intro: 'Intro',
			sections: [
				{
					heading: '🎬 Watch',
					items: [
						{
							title: 'Tom & Jerry',
							url: 'https://x/i/1',
							meta: 'added 3 months ago',
							note: 'Sam said so',
							actions: [{ label: 'Keep', url: 'https://x/a/t', primary: true }]
						}
					]
				}
			],
			reason: 'You get this weekly.'
		});
		expect(m.html).toContain('#f4f0e8');
		expect(m.html).toContain('#b23a1e');
		expect(m.html).toContain('Georgia');
		expect(m.html).toContain('Tom &amp; Jerry');
		expect(m.html).toContain('A few things &lt;you&gt; wanted');
		expect(m.html).toContain(`${env.origin}/settings#notifications`);
		expect(m.text).toContain('* Tom & Jerry');
		expect(m.text).toContain('Keep: https://x/a/t');
		expect(m.text).toContain('Manage or unsubscribe: ');
	});
	it('digest email lists items with snooze/drop links and goes through the transport', async () => {
		env.smtpUrl = 'smtp://test.invalid:25';
		const sent: { to: string; subject: string; html?: string; headers?: Record<string, string> }[] =
			[];
		setMailTransport({ sendMail: async (m) => void sent.push(m) });
		const c = cat({ name: 'Read', icon: '📚' });
		const it = item(c.id, {
			title: 'Piranesi',
			why: 'Mom loved it',
			recommendedBy: 'Mom',
			createdAt: ago(70)
		});
		seed([
			{ kind: 'category', row: c },
			{ kind: 'item', row: it }
		]);
		savePrefs(
			db,
			u,
			{
				digestFrequency: 'monthly',
				digestDayOfMonth: 1,
				timezone: 'UTC',
				quietStart: null,
				quietEnd: null
			},
			ago(60)
		);
		const r = await runTick({ db, now: NOW });
		setMailTransport(null);
		expect(r.sent).toBe(1);
		expect(sent).toHaveLength(1);
		expect(sent[0].subject).toBe('Your monthly Forgetless digest: 1 thing to try');
		expect(sent[0].html).toContain('Piranesi');
		expect(sent[0].html).toContain('from Mom');
		expect(sent[0].html).toContain('/a/');
		expect(sent[0].headers?.['List-Unsubscribe']).toContain('/settings#notifications');
	});
});
