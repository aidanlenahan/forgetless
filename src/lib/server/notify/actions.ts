// Keep / Drop / Snooze applied from a notification action link (see tokens.ts and routes/a/[token]).
import { and, eq, gt } from 'drizzle-orm';
import { schema, type DB } from '../db';
import { applyMutations, toItems } from '../repo';
import type { ItemAction } from '../../shared/notifications';
import type { ActionClaims } from './tokens';

export const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export type ActionResult =
	| { ok: true; action: ItemAction; itemId: string; title: string; until?: number }
	| { ok: false; reason: 'not_found' };

export function snoozeItem(db: DB, userId: string, itemId: string, until: number) {
	db.insert(schema.itemSnoozes)
		.values({ itemId, userId, until })
		.onConflictDoUpdate({ target: schema.itemSnoozes.itemId, set: { userId, until } })
		.run();
}

export function clearSnooze(db: DB, userId: string, itemId: string) {
	db.delete(schema.itemSnoozes)
		.where(and(eq(schema.itemSnoozes.itemId, itemId), eq(schema.itemSnoozes.userId, userId)))
		.run();
}

/** Active snoozes (until > now) for a user. */
export function activeSnoozes(db: DB, userId: string, now = Date.now()) {
	return db
		.select({ itemId: schema.itemSnoozes.itemId, until: schema.itemSnoozes.until })
		.from(schema.itemSnoozes)
		.where(and(eq(schema.itemSnoozes.userId, userId), gt(schema.itemSnoozes.until, now)))
		.all();
}

/**
 * Applies the action the token authorises. Item writes go through repo.applyMutations (LWW, FTS, sync
 * cursor), so every device picks the change up on its next pull.
 * - keep: touches updatedAt (it won't resurface for another N months), clears any snooze, undoes a drop
 * - drop: status → dropped
 * - snooze: hides it from digests and reminders for 30 days
 */
export function applyAction(db: DB, c: ActionClaims, now = Date.now()): ActionResult {
	const row = db
		.select()
		.from(schema.items)
		.where(and(eq(schema.items.id, c.itemId), eq(schema.items.userId, c.userId)))
		.get();
	if (!row || row.deletedAt) return { ok: false, reason: 'not_found' };
	const [item] = toItems(db, [row]);
	const updatedAt = Math.max(now, item.updatedAt + 1);
	if (c.action === 'keep') {
		// "Keep it instead" after a drop puts it back on the list.
		const status = item.status === 'dropped' ? 'want' : item.status;
		applyMutations(c.userId, [{ kind: 'item', row: { ...item, status, updatedAt } }], db);
		clearSnooze(db, c.userId, item.id);
		return { ok: true, action: 'keep', itemId: item.id, title: item.title };
	}
	if (c.action === 'drop') {
		if (item.status !== 'dropped')
			applyMutations(
				c.userId,
				[{ kind: 'item', row: { ...item, status: 'dropped', updatedAt } }],
				db
			);
		return { ok: true, action: 'drop', itemId: item.id, title: item.title };
	}
	const until = now + SNOOZE_MS;
	snoozeItem(db, c.userId, item.id, until);
	return { ok: true, action: 'snooze', itemId: item.id, title: item.title, until };
}
