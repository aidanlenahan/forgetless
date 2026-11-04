// Notification action links: /a/<signed token> applies Keep / Drop / Snooze to one item, without a session
// (the token authorises exactly that action on that item, and expires). GET renders a small confirmation
// page (email links); POST answers JSON (service worker notification buttons).
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { clientIp, limits, rateLimit } from '#lib/server/ratelimit.ts';
import { verifyAction, actionUrl } from '#lib/server/notify/tokens.ts';
import { applyAction, type ActionResult } from '#lib/server/notify/actions.ts';
import { esc } from '#lib/server/notify/email.ts';
import { isGuestUser } from '#lib/server/demo.ts';
import { APP_NAME } from '#lib/shared/config.ts';
import type { ItemAction } from '#lib/shared/notifications.ts';

const HEADERS = {
	'cache-control': 'no-store',
	'referrer-policy': 'no-referrer',
	'x-robots-tag': 'noindex'
};

function run(token: string): { status: number; result: ActionResult | null; reason?: string } {
	const v = verifyAction(token);
	if (!v.ok) return { status: v.reason === 'expired' ? 410 : 400, result: null, reason: v.reason };
	const db = getDb();
	if (isGuestUser(v.claims.userId, db))
		return { status: 404, result: { ok: false, reason: 'not_found' } };
	const result = applyAction(db, v.claims);
	return { status: result.ok ? 200 : 404, result };
}

const DONE: Record<ItemAction, (t: string, until?: number) => [string, string]> = {
	keep: (t) => [
		`Kept “${t}”`,
		"It stays on your list, and we won't ask about it again for a while."
	],
	drop: (t) => [
		`Dropped “${t}”`,
		"It's marked as dropped. You can change that from the item any time."
	],
	snooze: (t, until) => [
		`Snoozed “${t}”`,
		`It's left out of digests and reminders until ${until ? new Date(until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'next month'}.`
	]
};

function page(
	status: number,
	title: string,
	body: string,
	links: { label: string; url: string; primary?: boolean }[]
) {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark"><title>${esc(title)} · ${APP_NAME}</title>
<style>
:root{--bg:#f4f0e8;--card:#fbf9f5;--ink:#211c17;--muted:#5b5249;--border:#e0d8cb;--strong:#cbc0b0;--accent:#b23a1e;--on:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#171411;--card:#201c18;--ink:#efe8de;--muted:#bcb2a6;--border:#352f29;--strong:#4a423a;--accent:#ec7656;--on:#1d0f0a}}
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 'Instrument Sans',-apple-system,'Segoe UI',Roboto,sans-serif;padding:16px;box-sizing:border-box}
main{max-width:440px;width:100%;box-sizing:border-box;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:28px}
.brand{font:italic 500 18px/1 Newsreader,Georgia,serif;color:var(--accent);margin:0 0 18px}
h1{font:560 26px/1.15 Newsreader,Georgia,serif;letter-spacing:-.01em;margin:0 0 8px}
p{margin:0 0 20px;color:var(--muted)}
nav{display:flex;flex-wrap:wrap;gap:8px}
a.btn{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;border-radius:7px;border:1px solid var(--strong);color:var(--ink);text-decoration:none;font-weight:600;font-size:13px}
a.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on)}
</style></head><body><main>
<p class="brand">${APP_NAME}</p><h1>${esc(title)}</h1><p>${esc(body)}</p>
<nav>${links.map((l) => `<a class="btn${l.primary ? ' primary' : ''}" href="${esc(l.url)}">${esc(l.label)}</a>`).join('')}</nav>
</main></body></html>`;
	return new Response(html, {
		status,
		headers: { ...HEADERS, 'content-type': 'text/html; charset=utf-8' }
	});
}

export const GET: RequestHandler = (event) => {
	const limited = rateLimit([limits.notifyActionIp, clientIp(event)]);
	if (limited) return limited;
	const { status, result, reason } = run(event.params.token);
	if (!result)
		return page(
			status,
			reason === 'expired' ? 'This link has expired' : "This link doesn't work",
			reason === 'expired'
				? 'Action links in notifications are valid for 30 days. Open the item in the app instead.'
				: 'It may have been cut off by your email app. Open the item in the app instead.',
			[{ label: `Open ${APP_NAME}`, url: '/', primary: true }]
		);
	if (!result.ok)
		return page(
			status,
			'Item not found',
			'It may have been deleted since the notification went out.',
			[{ label: `Open ${APP_NAME}`, url: '/', primary: true }]
		);
	const v = verifyAction(event.params.token);
	const userId = v.ok ? v.claims.userId : '';
	const [title, body] = DONE[result.action](result.title, result.until);
	const other = (['keep', 'drop', 'snooze'] as const).filter((a) => a !== result.action);
	const label: Record<ItemAction, string> = {
		keep: 'Keep it instead',
		drop: 'Drop it instead',
		snooze: 'Snooze instead'
	};
	return page(200, title, body, [
		{ label: 'Open item', url: `/i/${result.itemId}`, primary: true },
		...other.map((a) => ({
			label: label[a],
			url: actionUrl({ userId, itemId: result.itemId, action: a })
		})),
		{ label: 'Notification settings', url: '/settings#notifications' }
	]);
};

export const POST: RequestHandler = (event) => {
	const limited = rateLimit([limits.notifyActionIp, clientIp(event)]);
	if (limited) return limited;
	const { status, result, reason } = run(event.params.token);
	if (!result) return json({ ok: false, reason }, { status, headers: HEADERS });
	return json(result, { status, headers: HEADERS });
};
