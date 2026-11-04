// Dependency-free so scripts/admin.ts can import it under plain Node type stripping.
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Deletes guest users whose guest_expires_at has passed. Their sessions, accounts, categories, items,
 * item_tags, log_entries and catalogs go via ON DELETE CASCADE; items_fts (a virtual table) and their
 * catalog rows in catalog_entries are cleaned explicitly.
 * Returns the number of users removed.
 */
export function purgeExpiredGuestsSql(sqlite: BetterSqlite3.Database, now = Date.now()): number {
	const tx = sqlite.transaction(() => {
		const ids = (
			sqlite
				.prepare(
					'SELECT id FROM user WHERE is_guest = 1 AND guest_expires_at IS NOT NULL AND guest_expires_at < ?'
				)
				.all(now) as { id: string }[]
		).map((r) => r.id);
		const delFts = sqlite.prepare('DELETE FROM items_fts WHERE user_id = ?');
		// catalog rows are keyed by source, not user, so they don't cascade; the catalogs row itself does.
		const delCatalogRows = sqlite.prepare(
			"DELETE FROM catalog_entries WHERE source IN (SELECT 'catalog:' || id FROM catalogs WHERE user_id = ?)"
		);
		const delUser = sqlite.prepare('DELETE FROM user WHERE id = ?');
		for (const id of ids) {
			delFts.run(id);
			delCatalogRows.run(id);
			delUser.run(id);
		}
		return ids.length;
	});
	return tx();
}
