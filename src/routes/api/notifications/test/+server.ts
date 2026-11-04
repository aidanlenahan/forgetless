import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';
import { requireNotifiable } from '#lib/server/notify/guard.ts';
import { sendTest } from '#lib/server/notify/service.ts';
import type { NotifyChannel } from '#lib/shared/notifications.ts';

/**
 * POST { channel?: 'email' | 'push' | 'all' } → { status, channels?, failed?, errors? }
 * Sends now, ignoring quiet hours and the daily cap. Rate limited to 5 an hour.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireNotifiable(event);
	const body = (await event.request.json().catch(() => ({}))) as { channel?: unknown };
	const ch = body?.channel ?? 'all';
	if (ch !== 'email' && ch !== 'push' && ch !== 'all')
		error(400, 'channel must be email, push or all');
	const limited = rateLimit([limits.notifyTestUser, user.id]);
	if (limited) return limited;
	const channels: NotifyChannel[] = ch === 'all' ? ['email', 'push'] : [ch];
	const out = await sendTest(getDb(), user, channels);
	if (out.status === 'no_channels')
		error(
			409,
			ch === 'push'
				? 'Turn on push on this device first.'
				: ch === 'email'
					? 'Email is not set up on this server.'
					: 'No channel is available: email is not set up and no device has push turned on.'
		);
	return json(out, { status: out.status === 'failed' ? 502 : 200 });
};
