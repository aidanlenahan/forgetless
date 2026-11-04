// Resurface: "You added this 6 months ago and haven't touched it. Still want it?" with Keep / Drop /
// Snooze 1 month. At most one reminder per day, with up to 3 items.
import { env } from '../env';
import type { NotificationPrefs } from '../../shared/notifications';
import type { DB } from '../db';
import { loadCandidates, type Candidate } from './candidates';
import { renderEmail } from './email';
import { actionUrl } from './tokens';
import { itemMeta, titleList, type BuiltMessage } from './digest';

export const RESURFACE_MAX_ITEMS = 3;

/** now minus `months` calendar months (UTC). */
export function monthsAgo(now: number, months: number): number {
	const d = new Date(now);
	d.setUTCMonth(d.getUTCMonth() - months);
	return d.getTime();
}

/** An item is stale when it was added, last edited and last logged before the cutoff. */
export function isStale(c: Candidate, cutoff: number): boolean {
	return (
		c.createdAt <= cutoff && c.updatedAt <= cutoff && (c.lastLogAt == null || c.lastLogAt <= cutoff)
	);
}

export function selectResurface(
	db: DB,
	userId: string,
	prefs: Pick<NotificationPrefs, 'resurfaceAfterMonths' | 'digestCategoryIds'>,
	now: number,
	limit = RESURFACE_MAX_ITEMS
): Candidate[] {
	const cutoff = monthsAgo(now, prefs.resurfaceAfterMonths);
	return loadCandidates(db, userId, now, prefs.digestCategoryIds)
		.filter((c) => isStale(c, cutoff))
		.sort(
			(a, b) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
		)
		.slice(0, limit);
}

export function buildResurface(
	userId: string,
	items: Candidate[],
	prefs: Pick<NotificationPrefs, 'resurfaceAfterMonths'>,
	now: number,
	opts: { test?: boolean } = {}
): BuiltMessage | null {
	if (!items.length) return null;
	const first = items[0];
	const one = items.length === 1;
	const months = prefs.resurfaceAfterMonths;
	const subject = `${opts.test ? '[Test] ' : ''}${
		one
			? `Still want to try “${first.title}”?`
			: `Still want these? ${titleList(
					items.map((i) => i.title),
					1
				)}`
	}`;
	const links = (c: Candidate) => ({
		keep: actionUrl({ userId, itemId: c.id, action: 'keep' }, now),
		drop: actionUrl({ userId, itemId: c.id, action: 'drop' }, now),
		snooze: actionUrl({ userId, itemId: c.id, action: 'snooze' }, now)
	});
	const email = renderEmail({
		subject,
		preheader: `You added ${one ? 'this' : 'these'} more than ${months} month${months === 1 ? '' : 's'} ago.`,
		heading: one ? 'Still want this?' : 'Still want these?',
		intro: `You added ${one ? 'this' : 'these'} more than ${months} month${months === 1 ? '' : 's'} ago and haven't touched ${one ? 'it' : 'them'} since. Keep, drop or snooze: one tap, no sign-in needed.`,
		sections: [
			{
				heading: 'From your lists',
				items: items.map((c) => {
					const l = links(c);
					return {
						title: c.title,
						url: `${env.origin}/i/${c.id}`,
						meta: itemMeta(c, now, true),
						note: c.why ?? undefined,
						actions: [
							{ label: 'Keep', url: l.keep, primary: true },
							{ label: 'Drop', url: l.drop },
							{ label: 'Snooze 1 month', url: l.snooze }
						]
					};
				})
			}
		],
		reason: opts.test
			? 'This is a test from your notification settings.'
			: `You turned on reminders for things you saved more than ${months} months ago.`
	});
	const l = links(first);
	return {
		itemIds: items.map((c) => c.id),
		email,
		push: {
			title: `${opts.test ? '[Test] ' : ''}Still want “${first.title}”?`,
			body: `${itemMeta(first, now, true)}${items.length > 1 ? `. Plus ${titleList(items.slice(1).map((i) => i.title))}.` : ''}`,
			kind: opts.test ? 'test' : 'resurface',
			tag: opts.test ? 'test' : 'resurface',
			url: `${env.origin}/i/${first.id}`,
			actions: [
				{ action: 'keep', title: 'Keep', url: l.keep },
				{ action: 'snooze', title: 'Snooze 1 month', url: l.snooze },
				{ action: 'drop', title: 'Drop', url: l.drop }
			]
		}
	};
}
