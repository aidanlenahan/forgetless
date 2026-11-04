// Items that may be surfaced in a digest or resurface reminder.
import type { DB } from '../db';
import { DAY_MS } from './time';

/** An item surfaced (digest or resurface) is skipped for this long. */
export const SURFACE_COOLDOWN_MS = 30 * DAY_MS;

export interface Candidate {
	id: string;
	title: string;
	categoryId: string;
	categoryName: string;
	categoryIcon: string;
	categorySort: number;
	recommendedBy: string | null;
	why: string | null;
	customFields: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
	/** latest non-deleted log entry activity (updatedAt), if any */
	lastLogAt: number | null;
}

/**
 * `want` items of the user that are not deleted (nor their list), not snoozed, and not surfaced in the
 * last 30 days. `categoryIds` null = all lists.
 */
export function loadCandidates(
	db: DB,
	userId: string,
	now: number,
	categoryIds: string[] | null
): Candidate[] {
	if (categoryIds && !categoryIds.length) return [];
	const scope = categoryIds ? `AND i.category_id IN (${categoryIds.map(() => '?').join(',')})` : '';
	const rows = db.sqlite
		.prepare(
			`SELECT i.id, i.title, i.category_id AS categoryId, c.name AS categoryName, c.icon AS categoryIcon,
			        c.sort AS categorySort, i.recommended_by AS recommendedBy, i.why, i.custom_fields AS customFields,
			        i.created_at AS createdAt, i.updated_at AS updatedAt,
			        (SELECT MAX(l.updated_at) FROM log_entries l WHERE l.item_id = i.id AND l.deleted_at IS NULL) AS lastLogAt
			 FROM items i
			 JOIN categories c ON c.id = i.category_id AND c.user_id = i.user_id AND c.deleted_at IS NULL
			 WHERE i.user_id = ? AND i.status = 'want' AND i.deleted_at IS NULL ${scope}
			   AND NOT EXISTS (SELECT 1 FROM item_snoozes s WHERE s.item_id = i.id AND s.until > ?)
			   AND NOT EXISTS (SELECT 1 FROM item_surfaced f WHERE f.user_id = i.user_id AND f.item_id = i.id AND f.surfaced_at > ?)`
		)
		.all(userId, ...(categoryIds ?? []), now, now - SURFACE_COOLDOWN_MS) as (Omit<
		Candidate,
		'customFields'
	> & { customFields: string | null })[];
	return rows.map((r) => {
		let customFields: Record<string, unknown> = {};
		try {
			customFields = r.customFields ? JSON.parse(r.customFields) : {};
		} catch {
			/* ignore */
		}
		return { ...r, customFields };
	});
}

/** Records that these items were just surfaced (starts their 30-day cooldown). */
export function markSurfaced(db: DB, userId: string, itemIds: string[], now: number) {
	const stmt = db.sqlite.prepare(
		`INSERT INTO item_surfaced (item_id, user_id, surfaced_at) VALUES (?, ?, ?)
		 ON CONFLICT (user_id, item_id) DO UPDATE SET surfaced_at = excluded.surfaced_at`
	);
	db.sqlite.transaction(() => {
		for (const id of itemIds) stmt.run(id, userId, now);
	})();
}

/** "3 days", "7 months", "2 years" */
export function ageLabel(ms: number): string {
	const days = Math.max(0, Math.floor(ms / DAY_MS));
	if (days < 1) return 'today';
	if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
	if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
	if (days < 730) return `${Math.floor(days / 30.44)} months ago`;
	return `${Math.floor(days / 365.25)} years ago`;
}
