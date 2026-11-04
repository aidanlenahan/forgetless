// Better Auth browser client (same origin; endpoints at /api/auth/*).
import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient();

/** Better Auth error -> human message. */
export function authErrorMessage(
	err: { message?: string; status?: number; code?: string } | null | undefined
): string {
	if (!err) return 'Something went wrong';
	if (err.status === 429) return 'Too many attempts. Please wait a minute and try again.';
	return err.message || 'Something went wrong';
}
