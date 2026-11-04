// Signed, expiring action links for notifications: /a/<token> applies exactly one action to one item.
// token = base64url(JSON claims) "." base64url(HMAC-SHA256(key, payload)); key derived from APP_AUTH_SECRET.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';
import type { ItemAction } from '../../shared/notifications';

export interface ActionClaims {
	userId: string;
	itemId: string;
	action: ItemAction;
	/** expiry, epoch ms */
	exp: number;
}

export const ACTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIONS: ItemAction[] = ['keep', 'drop', 'snooze'];

const key = (secret: string) =>
	createHmac('sha256', secret).update('forgetless:notify-action:v1').digest();
const sign = (payload: string, secret: string) =>
	createHmac('sha256', key(secret)).update(payload).digest('base64url');

export function signAction(
	c: Omit<ActionClaims, 'exp'> & { exp?: number },
	now = Date.now(),
	secret = env.authSecret
): string {
	const exp = c.exp ?? now + ACTION_TTL_MS;
	const payload = Buffer.from(
		JSON.stringify({ u: c.userId, i: c.itemId, a: c.action, e: Math.floor(exp / 1000) })
	).toString('base64url');
	return `${payload}.${sign(payload, secret)}`;
}

export type VerifyResult =
	| { ok: true; claims: ActionClaims }
	| { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyAction(
	token: string,
	now = Date.now(),
	secret = env.authSecret
): VerifyResult {
	if (typeof token !== 'string' || token.length > 600) return { ok: false, reason: 'malformed' };
	const [payload, sig, extra] = token.split('.');
	if (!payload || !sig || extra !== undefined) return { ok: false, reason: 'malformed' };
	const expected = Buffer.from(sign(payload, secret));
	const got = Buffer.from(sig);
	if (expected.length !== got.length || !timingSafeEqual(expected, got))
		return { ok: false, reason: 'bad_signature' };
	let c: { u?: unknown; i?: unknown; a?: unknown; e?: unknown };
	try {
		c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	} catch {
		return { ok: false, reason: 'malformed' };
	}
	if (
		typeof c.u !== 'string' ||
		typeof c.i !== 'string' ||
		!ACTIONS.includes(c.a as ItemAction) ||
		typeof c.e !== 'number'
	)
		return { ok: false, reason: 'malformed' };
	const exp = c.e * 1000;
	if (exp < now) return { ok: false, reason: 'expired' };
	return { ok: true, claims: { userId: c.u, itemId: c.i, action: c.a as ItemAction, exp } };
}

export function actionUrl(
	c: Omit<ActionClaims, 'exp'>,
	now = Date.now(),
	origin = env.origin
): string {
	return `${origin}/a/${signAction(c, now)}`;
}
