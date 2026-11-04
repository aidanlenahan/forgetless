import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { getAuth } from '#lib/server/auth.ts';
import { env } from '#lib/server/env.ts';

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
