import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guard.ts';
import { activeSnoozes } from '#lib/server/notify/actions.ts';

/** GET /api/notifications/snoozes → { snoozes: { itemId, until }[] } (active ones only) */
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	return json({ snoozes: activeSnoozes(getDb(), user.id) });
};
