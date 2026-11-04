import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { FieldDef } from '../../shared/types';

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
	(t) => [
		index('log_user_sync').on(t.userId, t.serverUpdatedAt),
		index('log_item').on(t.itemId)
	]
);
