// Entry points used by the /api/notifications routes.
import { uuidv7 } from 'uuidv7';
import type { DB } from '../db';
import { env } from '../env';
import { APP_NAME } from '../../shared/config';
import type {
	NotifyChannel,
	PreviewItem,
	PreviewResponse,
	PrefsResponse
} from '../../shared/notifications';
import { getPrefs, getStoredPrefs, type StoredPrefs } from './prefs';
import { deliverableEmail } from './policy';
import { emailConfigured, renderEmail } from './email';
import { listSubscriptions } from './push';
import { buildDigest, selectDigest, type BuiltMessage, type ScoredItem } from './digest';
import { buildResurface, selectResurface } from './resurface';
import { nextDailySlot, nextDigestSlot } from './schedule';
import { deliver, type DeliverOutcome, type NotifyUser, type Senders } from './scheduler';
import { DAY_MS } from './time';
import type { Candidate } from './candidates';

export function prefsResponse(db: DB, user: NotifyUser): PrefsResponse {
	const { prefs, saved } = getPrefs(db, user.id);
	return {
		prefs,
		saved,
		email: deliverableEmail(user.email) ? user.email : null,
		channels: { email: emailConfigured(), push: true },
		subscriptions: listSubscriptions(db, user.id)
	};
}

function stored(db: DB, userId: string, now: number): StoredPrefs {
	return (
		getStoredPrefs(db, userId) ?? {
			...getPrefs(db, userId).prefs,
			userId,
			scheduleChangedAt: now,
			updatedAt: now
		}
	);
}

const toPreview = (c: Candidate | ScoredItem, now: number): PreviewItem => ({
	id: c.id,
	title: c.title,
	categoryId: c.categoryId,
	categoryName: c.categoryName,
	categoryIcon: c.categoryIcon,
	ageDays: Math.floor((now - c.createdAt) / DAY_MS),
	score: 'score' in c ? Math.round(c.score * 10) / 10 : 0
});

/** What the digest / resurface reminder would contain if it went out now. */
export function preview(
	db: DB,
	userId: string,
	kind: 'digest' | 'resurface',
	now = Date.now()
): PreviewResponse {
	const p = stored(db, userId, now);
	if (kind === 'digest') {
		const groups = selectDigest(db, userId, p, now);
		const msg = buildDigest(userId, groups, p, now);
		return {
			kind,
			empty: !msg,
			subject: msg?.email.subject ?? 'Nothing to send: no items are due for a digest.',
			items: groups.flatMap((g) => g.items.map((c) => toPreview(c, now))),
			nextAt: nextDigestSlot(p, now)?.at ?? null
		};
	}
	const items = selectResurface(db, userId, p, now);
	const msg = buildResurface(userId, items, p, now);
	return {
		kind,
		empty: !msg,
		subject: msg?.email.subject ?? 'Nothing to send: no items are old enough to resurface.',
		items: items.map((c) => toPreview(c, now)),
		nextAt: p.resurfaceEnabled ? nextDailySlot(p, now).at : null
	};
}

/** A test message: the current digest content if there is any, otherwise a short "it works" note. */
function testMessage(db: DB, userId: string, p: StoredPrefs, now: number): BuiltMessage {
	const digest = buildDigest(userId, selectDigest(db, userId, p, now), p, now, { test: true });
	if (digest) return digest;
	const email = renderEmail({
		subject: `[Test] ${APP_NAME} notifications work`,
		preheader: 'Your notification settings are working.',
		heading: 'Notifications work',
		intro:
			"This is a test from your notification settings. Your digest will list things from your lists here, once you've saved a few.",
		sections: [],
		cta: { label: `Open ${APP_NAME}`, url: `${env.origin}/` },
		reason: 'You asked for this test.'
	});
	return {
		itemIds: [],
		email,
		push: {
			title: `${APP_NAME} notifications work`,
			body: 'This is a test from your notification settings.',
			kind: 'test',
			tag: 'test',
			url: `${env.origin}/settings#notifications`
		}
	};
}

export async function sendTest(
	db: DB,
	user: NotifyUser,
	requested: NotifyChannel[],
	now = Date.now(),
	senders?: Senders
): Promise<DeliverOutcome> {
	const p = stored(db, user.id, now);
	const channels = requested.filter((ch) =>
		ch === 'email'
			? emailConfigured() && deliverableEmail(user.email)
			: listSubscriptions(db, user.id).length > 0
	);
	return deliver({
		db,
		user,
		prefs: p,
		kind: 'test',
		periodKey: `test:${uuidv7()}`,
		channels,
		build: () => testMessage(db, user.id, p, now),
		now,
		senders,
		bypassPolicy: true
	});
}
