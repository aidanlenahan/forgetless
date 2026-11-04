import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { getAuth } from '#lib/server/auth.ts';
import { env } from '#lib/server/env.ts';
import { purgeExpiredGuests } from '#lib/server/demo.ts';

/** Runs once before the first request: purge expired guest accounts, then hourly while running. */
export const init: ServerInit = () => {
	if (building) return;
	const purge = () => {
		try {
			const n = purgeExpiredGuests();
			if (n) console.log(`[demo] purged ${n} expired guest account(s)`);
		} catch (err) {
			console.error('[demo] guest purge failed', err);
		}
	};
	purge();
	const g = globalThis as unknown as { __appPurgeTimer?: ReturnType<typeof setInterval> };
	if (g.__appPurgeTimer) clearInterval(g.__appPurgeTimer); // dev HMR re-runs init
	g.__appPurgeTimer = setInterval(purge, 60 * 60 * 1000);
	g.__appPurgeTimer.unref?.();
};

export const handle: Handle = async ({ event, resolve }) => {
	if (building) return resolve(event);

	// Public signups can be disabled by config (e.g. on the demo instance). Guest/demo accounts are
	// created server-side via /api/demo and are not affected.
	if (!env.allowSignup && event.url.pathname.startsWith('/api/auth/sign-up')) {
		return new Response(JSON.stringify({ message: 'Sign-ups are disabled on this instance' }), {
			status: 403,
			headers: { 'content-type': 'application/json' }
		});
	}

	const auth = getAuth();
	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;

	return svelteKitHandler({ event, resolve, auth, building });
};
