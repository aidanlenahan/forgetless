import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';
import { requireNotifiable } from '#lib/server/notify/guard.ts';
import { preview } from '#lib/server/notify/service.ts';

/** GET /api/notifications/preview?kind=digest|resurface → PreviewResponse (nothing is sent or recorded) */
export const GET: RequestHandler = (event) => {
	const user = requireNotifiable(event);
	const limited = rateLimit([limits.notifyUser, user.id]);
	if (limited) return limited;
	const kind = event.url.searchParams.get('kind') ?? 'digest';
	if (kind !== 'digest' && kind !== 'resurface') error(400, 'kind must be digest or resurface');
	return json(preview(getDb(), user.id, kind));
};
