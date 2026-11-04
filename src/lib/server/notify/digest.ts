// Digest: N `want` items per list, scored by age × (1 + priority), skipping items surfaced in the last
// 30 days and snoozed ones. An empty digest is not sent.
import { env } from '../env';
import { APP_NAME } from '../../shared/config';
import type { NotificationPrefs, PushPayload } from '../../shared/notifications';
import type { DB } from '../db';
import { ageLabel, loadCandidates, type Candidate } from './candidates';
import { renderEmail, type EmailSection } from './email';
import { actionUrl } from './tokens';
import { DAY_MS } from './time';

/**
 * Item priority for scoring. The priority field (PRD Phase 2: low / normal / high) isn't built yet, so
 * every item counts as 0. When it lands, map it here (e.g. low = 0, normal = 0.5, high = 1).
 */
export function priorityOf(_item: Pick<Candidate, 'customFields'>): number {
	return 0;
}

export function digestScore(item: Candidate, now: number): number {
	const ageDays = Math.max(0, (now - item.createdAt) / DAY_MS);
	return ageDays * (1 + priorityOf(item));
}

export interface ScoredItem extends Candidate {
	ageDays: number;
	score: number;
}
export interface DigestGroup {
	categoryId: string;
	categoryName: string;
	categoryIcon: string;
	items: ScoredItem[];
}

export function selectDigest(
	db: DB,
	userId: string,
	prefs: Pick<NotificationPrefs, 'digestCategoryIds' | 'digestItemsPerCategory'>,
	now: number
): DigestGroup[] {
	const groups = new Map<string, DigestGroup & { sort: number }>();
	for (const c of loadCandidates(db, userId, now, prefs.digestCategoryIds)) {
		const g = groups.get(c.categoryId) ?? {
			categoryId: c.categoryId,
			categoryName: c.categoryName,
			categoryIcon: c.categoryIcon,
			sort: c.categorySort,
			items: []
		};
		g.items.push({
			...c,
			ageDays: Math.floor((now - c.createdAt) / DAY_MS),
			score: digestScore(c, now)
		});
		groups.set(c.categoryId, g);
	}
	return [...groups.values()]
		.sort((a, b) => a.sort - b.sort || a.categoryName.localeCompare(b.categoryName))
		.map(({ sort: _s, ...g }) => ({
			...g,
			items: g.items
				.sort((a, b) => b.score - a.score || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
				.slice(0, prefs.digestItemsPerCategory)
		}))
		.filter((g) => g.items.length);
}

export interface BuiltMessage {
	itemIds: string[];
	email: { subject: string; text: string; html: string };
	push: PushPayload;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n: number) =>
	`${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export function scheduleLabel(
	p: Pick<
		NotificationPrefs,
		'digestFrequency' | 'digestDayOfWeek' | 'digestDayOfMonth' | 'digestHour'
	>
): string {
	const at = `${String(p.digestHour).padStart(2, '0')}:00`;
	if (p.digestFrequency === 'weekly') return `every ${DAYS[p.digestDayOfWeek]} at ${at}`;
	if (p.digestFrequency === 'monthly')
		return `on the ${ordinal(p.digestDayOfMonth)} of each month at ${at}`;
	return 'never';
}

export function titleList(titles: string[], max = 3): string {
	const shown = titles.slice(0, max).join(', ');
	return titles.length > max ? `${shown} and ${titles.length - max} more` : shown;
}

export function itemMeta(c: Candidate, now: number, withList = false) {
	return [
		withList ? `${c.categoryIcon} ${c.categoryName}` : null,
		`added ${ageLabel(now - c.createdAt)}`,
		c.recommendedBy ? `from ${c.recommendedBy}` : null
	]
		.filter(Boolean)
		.join(' · ');
}

export function buildDigest(
	userId: string,
	groups: DigestGroup[],
	prefs: Pick<
		NotificationPrefs,
		'digestFrequency' | 'digestDayOfWeek' | 'digestDayOfMonth' | 'digestHour'
	>,
	now: number,
	opts: { test?: boolean } = {}
): BuiltMessage | null {
	const all = groups.flatMap((g) => g.items);
	if (!all.length) return null;
	const period = prefs.digestFrequency === 'monthly' ? 'monthly' : 'weekly';
	const n = all.length;
	const subject = `${opts.test ? '[Test] ' : ''}Your ${period} ${APP_NAME} digest: ${n} thing${n === 1 ? '' : 's'} to try`;
	const sections: EmailSection[] = groups.map((g) => ({
		heading: `${g.categoryIcon} ${g.categoryName}`,
		items: g.items.map((c) => ({
			title: c.title,
			url: `${env.origin}/i/${c.id}`,
			meta: itemMeta(c, now),
			note: c.why ?? undefined,
			actions: [
				{
					label: 'Snooze 1 month',
					url: actionUrl({ userId, itemId: c.id, action: 'snooze' }, now)
				},
				{ label: 'Drop', url: actionUrl({ userId, itemId: c.id, action: 'drop' }, now) }
			]
		}))
	}));
	const email = renderEmail({
		subject,
		preheader: titleList(all.map((c) => c.title)),
		heading: 'A few things you wanted to try',
		intro:
			'Picked from your lists, longest-waiting first. Anything in this digest stays out of the next one for 30 days.',
		sections,
		cta: { label: `Open ${APP_NAME}`, url: `${env.origin}/` },
		reason: opts.test
			? 'This is a test from your notification settings.'
			: `You get this digest ${scheduleLabel(prefs)}.`
	});
	return {
		itemIds: all.map((c) => c.id),
		email,
		push: {
			title: `${opts.test ? '[Test] ' : ''}Your ${period} digest`,
			body: titleList(all.map((c) => c.title)),
			kind: opts.test ? 'test' : 'digest',
			tag: opts.test ? 'test' : 'digest',
			url: `${env.origin}/`
		}
	};
}
