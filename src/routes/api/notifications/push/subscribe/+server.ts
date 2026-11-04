import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';
import { requireNotifiable } from '#lib/server/notify/guard.ts';
import {
	deleteSubscription,
	listSubscriptions,
	parseSubscription,
	saveSubscription
} from '#lib/server/notify/push.ts';

/** POST { subscription: PushSubscriptionJSON } → 201 { subscription, subscriptions } */
export const POST: RequestHandler = async (event) => {
	const user = requireNotifiable(event);
	const limited = rateLimit([limits.notifyUser, user.id]);
	if (limited) return limited;
	const body = (await event.request.json().catch(() => null)) as { subscription?: unknown } | null;
	const sub = parseSubscription(body?.subscription);
	if (!sub) error(400, 'Expected { subscription: { endpoint, keys: { p256dh, auth } } }');
	const db = getDb();
	if (listSubscriptions(db, user.id).filter((s) => s.endpoint !== sub.endpoint).length >= 20)
		error(409, 'Too many devices subscribed. Remove one first.');
	const saved = saveSubscription(db, user.id, sub, event.request.headers.get('user-agent'));
	return json(
		{ subscription: saved, subscriptions: listSubscriptions(db, user.id) },
		{ status: 201 }
	);
};

/** DELETE { endpoint } → { ok, subscriptions } */
export const DELETE: RequestHandler = async (event) => {
	const user = requireNotifiable(event);
	const limited = rateLimit([limits.notifyUser, user.id]);
	if (limited) return limited;
	const body = (await event.request.json().catch(() => null)) as { endpoint?: unknown } | null;
	if (typeof body?.endpoint !== 'string') error(400, 'Expected { endpoint }');
	const db = getDb();
	const ok = deleteSubscription(db, user.id, body.endpoint);
	return json({ ok, subscriptions: listSubscriptions(db, user.id) });
};
