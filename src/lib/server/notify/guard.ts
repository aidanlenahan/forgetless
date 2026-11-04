import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '../guard';
import { isGuestUser } from '../demo';
import type { NotifyUser } from './scheduler';

/** Signed-in, non-guest user (demo accounts don't get notifications), or throws 401/403. */
export function requireNotifiable(event: Pick<RequestEvent, 'locals'>): NotifyUser {
	const u = requireUser(event);
	if (u.isGuest || isGuestUser(u.id)) error(403, 'Notifications are off for demo accounts');
	return { id: u.id, email: u.email, isGuest: false };
}
