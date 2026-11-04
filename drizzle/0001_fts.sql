-- FTS5 index over a user's items. Maintained by app code (src/lib/server/search.ts), not triggers,
-- because tags live in a separate table. This is the only SQLite-specific SQL in the app (PRD §7).
CREATE VIRTUAL TABLE IF NOT EXISTS `items_fts` USING fts5(
	item_id UNINDEXED,
	user_id UNINDEXED,
	title,
	recommended_by,
	source,
	why,
	tags,
	tokenize = 'unicode61 remove_diacritics 2'
);
