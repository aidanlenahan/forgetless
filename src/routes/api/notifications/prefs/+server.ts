import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';
import { requireNotifiable } from '#lib/server/notify/guard.ts';
import { savePrefs } from '#lib/server/notify/prefs.ts';
import { prefsResponse } from '#lib/server/notify/service.ts';

/** GET /api/notifications/prefs → PrefsResponse */
export const GET: RequestHandler = (event) => {
	const user = requireNotifiable(event);
	const limited = rateLimit([limits.notifyUser, user.id]);
	if (limited) return limited;
	return json(prefsResponse(getDb(), user));
};

/** PUT /api/notifications/prefs (partial NotificationPrefs) → PrefsResponse */
export const PUT: RequestHandler = async (event) => {
	const user = requireNotifiable(event);
	const limited = rateLimit([limits.notifyUser, user.id]);
	if (limited) return limited;
	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object' || Array.isArray(body))
		error(400, 'Expected a JSON object');
	const db = getDb();
	savePrefs(db, user.id, body);
	return json(prefsResponse(db, user));
};
