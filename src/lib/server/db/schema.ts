import {
	sqliteTable,
	text,
	integer,
	primaryKey,
	index,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import type { CatalogMapping, FieldDef } from '../../shared/types';

// ---------- Better Auth tables (names/columns follow Better Auth's core schema) ----------
export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	image: text('image'),
	isGuest: integer('is_guest', { mode: 'boolean' }).notNull().default(false),
	guestExpiresAt: integer('guest_expires_at', { mode: 'timestamp_ms' }),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' })
});

export const account = sqliteTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
	refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
	scope: text('scope'),
	password: text('password'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const verification = sqliteTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
});

// ---------- App tables. Timestamps are epoch ms numbers. ----------
export const categories = sqliteTable(
	'categories',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		icon: text('icon').notNull().default('📌'),
		sort: integer('sort').notNull().default(0),
		provider: text('provider'),
		fieldSchema: text('field_schema', { mode: 'json' }).$type<FieldDef[]>().notNull().default([]),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		deletedAt: integer('deleted_at'),
		/** server receive time, used as the sync cursor */
		serverUpdatedAt: integer('server_updated_at').notNull()
	},
	(t) => [index('categories_user_sync').on(t.userId, t.serverUpdatedAt)]
);

export const catalogEntries = sqliteTable(
	'catalog_entries',
	{
		id: text('id').primaryKey(),
		source: text('source').notNull(),
		externalId: text('external_id').notNull(),
		kind: text('kind').notNull(),
		title: text('title').notNull(),
		subtitle: text('subtitle'),
		year: integer('year'),
		imageUrl: text('image_url'),
		data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
		fetchedAt: integer('fetched_at').notNull()
	},
	(t) => [uniqueIndex('catalog_source_ext').on(t.source, t.externalId)]
);

export const items = sqliteTable(
	'items',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		categoryId: text('category_id').notNull(),
		catalogEntryId: text('catalog_entry_id'),
		title: text('title').notNull(),
		status: text('status').notNull().default('want'),
		recommendedBy: text('recommended_by'),
		source: text('source'),
		why: text('why'),
		customFields: text('custom_fields', { mode: 'json' })
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		needsMatch: integer('needs_match', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		deletedAt: integer('deleted_at'),
		serverUpdatedAt: integer('server_updated_at').notNull()
	},
	(t) => [
		index('items_user_sync').on(t.userId, t.serverUpdatedAt),
		index('items_user_category').on(t.userId, t.categoryId)
	]
);

export const itemTags = sqliteTable(
	'item_tags',
	{
		itemId: text('item_id')
			.notNull()
			.references(() => items.id, { onDelete: 'cascade' }),
		tag: text('tag').notNull() // stored lower-cased
	},
	(t) => [primaryKey({ columns: [t.itemId, t.tag] })]
);

export const logEntries = sqliteTable(
	'log_entries',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		itemId: text('item_id').notNull(),
		date: text('date').notNull(),
		rating: integer('rating'),
		note: text('note'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		deletedAt: integer('deleted_at'),
		serverUpdatedAt: integer('server_updated_at').notNull()
	},
	(t) => [index('log_user_sync').on(t.userId, t.serverUpdatedAt), index('log_item').on(t.itemId)]
);

/** User-imported autocomplete sources for a category (PRD §5). Rows live in catalog_entries with
 * source = 'catalog:<id>' and are private to the owner. */
export const catalogs = sqliteTable(
	'catalogs',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		categoryId: text('category_id').notNull(),
		name: text('name').notNull(),
		columnMap: text('column_map', { mode: 'json' }).$type<CatalogMapping>().notNull(),
		rowCount: integer('row_count').notNull().default(0),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [index('catalogs_user_category').on(t.userId, t.categoryId)]
);

// ---------- Phase 3: notifications ----------

/** Instance-wide key/value settings (e.g. generated VAPID keys). */
export const appSettings = sqliteTable('app_settings', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
	updatedAt: integer('updated_at').notNull()
});

export type DigestFrequency = 'off' | 'weekly' | 'monthly';

/** Per-user notification settings. No row = everything off (defaults in notify/prefs.ts). */
export const notificationPrefs = sqliteTable('notification_prefs', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	emailEnabled: integer('email_enabled', { mode: 'boolean' }).notNull().default(true),
	pushEnabled: integer('push_enabled', { mode: 'boolean' }).notNull().default(false),
	digestFrequency: text('digest_frequency').$type<DigestFrequency>().notNull().default('off'),
	/** 0 = Sunday … 6 = Saturday (weekly digests) */
	digestDayOfWeek: integer('digest_day_of_week').notNull().default(0),
	/** 1–31, clamped to the month's length (monthly digests) */
	digestDayOfMonth: integer('digest_day_of_month').notNull().default(1),
	/** local hour 0–23 at which digests and resurface reminders go out */
	digestHour: integer('digest_hour').notNull().default(9),
	digestItemsPerCategory: integer('digest_items_per_category').notNull().default(3),
	/** category ids to include; null = all lists */
	digestCategoryIds: text('digest_category_ids', { mode: 'json' }).$type<string[] | null>(),
	resurfaceEnabled: integer('resurface_enabled', { mode: 'boolean' }).notNull().default(false),
	resurfaceAfterMonths: integer('resurface_after_months').notNull().default(6),
	/** quiet hours as local minutes after midnight; both null = no quiet hours */
	quietStart: integer('quiet_start'),
	quietEnd: integer('quiet_end'),
	/** IANA time zone, captured from the browser */
	timezone: text('timezone').notNull().default('UTC'),
	/** max digest/resurface notifications per local day (tests don't count) */
	dailyCap: integer('daily_cap').notNull().default(3),
	/** when the schedule last changed; slots before it are never sent (no surprise send on enable) */
	scheduleChangedAt: integer('schedule_changed_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export const pushSubscriptions = sqliteTable(
	'push_subscriptions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull().unique(),
		keys: text('keys', { mode: 'json' }).$type<{ p256dh: string; auth: string }>().notNull(),
		userAgent: text('user_agent'),
		createdAt: integer('created_at').notNull(),
		lastSuccessAt: integer('last_success_at'),
		failureCount: integer('failure_count').notNull().default(0)
	},
	(t) => [index('push_subs_user').on(t.userId)]
);

/** One row per (user, kind, period, channel): the idempotency key for scheduled sends. */
export const notificationLog = sqliteTable(
	'notification_log',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<'digest' | 'resurface' | 'test'>().notNull(),
		/** 'none' marks an event that had nothing to send (empty digest) */
		channel: text('channel').$type<'email' | 'push' | 'none'>().notNull(),
		periodKey: text('period_key').notNull(),
		itemIds: text('item_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
		sentAt: integer('sent_at').notNull(),
		status: text('status').$type<'pending' | 'sent' | 'failed' | 'empty'>().notNull(),
		attempts: integer('attempts').notNull().default(1),
		error: text('error')
	},
	(t) => [
		uniqueIndex('notification_log_once').on(t.userId, t.kind, t.periodKey, t.channel),
		index('notification_log_user_sent').on(t.userId, t.sentAt)
	]
);

/** Last time an item was included in a digest/resurface (skip for 30 days). */
export const itemSurfaced = sqliteTable(
	'item_surfaced',
	{
		itemId: text('item_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		surfacedAt: integer('surfaced_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.itemId] })]
);

/** "Snooze 1 month" from a resurface reminder. Snoozed items are left out of digests and reminders. */
export const itemSnoozes = sqliteTable(
	'item_snoozes',
	{
		itemId: text('item_id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		until: integer('until').notNull()
	},
	(t) => [index('item_snoozes_user').on(t.userId)]
);
