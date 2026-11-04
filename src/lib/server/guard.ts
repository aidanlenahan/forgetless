import { error, type RequestEvent } from '@sveltejs/kit';

/** Returns the signed-in user or throws 401. */
export function requireUser(event: Pick<RequestEvent, 'locals'>) {
	const u = event.locals.user;
	if (!u) error(401, 'Not signed in');
	return u;
}
