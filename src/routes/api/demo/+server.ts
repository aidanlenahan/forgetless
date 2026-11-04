import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuth } from '#lib/server/auth.ts';
import { env } from '#lib/server/env.ts';
import { markGuest, purgeExpiredGuests, seedDemoData } from '#lib/server/demo.ts';
import { limits, rateLimit, clientIp } from '#lib/server/ratelimit.ts';

const randomHex = (bytes: number) =>
	Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
		b.toString(16).padStart(2, '0')
	).join('');

/**
 * POST /api/demo → creates a guest account (wiped after 24 h), seeds sample data and signs it in
 * (session cookie set on the response). Response: { user: { id, name, email, isGuest, guestExpiresAt } }
 */
export const POST: RequestHandler = async (event) => {
	if (!env.demoEnabled) error(404, 'Demo mode is disabled');
	const limited = rateLimit([limits.demoIp, clientIp(event)]);
	if (limited) return limited;

	purgeExpiredGuests();

	// Server-side API call: not subject to the /api/auth/sign-up block in hooks.server.ts, so this works
	// with APP_ALLOW_SIGNUP=false. The sveltekitCookies plugin copies the session cookie onto the response.
	const email = `guest-${randomHex(8)}@demo.invalid`;
	const res = await getAuth().api.signUpEmail({
		body: { email, password: randomHex(24), name: 'Guest' },
		headers: event.request.headers
	});
	const userId = res.user.id;
	const now = Date.now();
	markGuest(userId, undefined, now);
	seedDemoData(userId, undefined, now);

	return json({
		user: {
			id: userId,
			name: res.user.name,
			email,
			isGuest: true,
			guestExpiresAt: now + env.guestTtlMs
		}
	});
};
