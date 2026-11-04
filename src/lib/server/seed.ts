import { uuidv7 } from 'uuidv7';
import { getDb, schema } from './db';
import { monotonicNow } from './clock';
import type { FieldDef } from '../shared/types';

export const DEFAULT_CATEGORIES: {
	name: string;
	icon: string;
	provider: string | null;
	fieldSchema: FieldDef[];
}[] = [
	{ name: 'Watch', icon: '🎬', provider: 'tmdb', fieldSchema: [] },
	{
		name: 'Read',
		icon: '📚',
		provider: null,
		fieldSchema: [{ key: 'author', label: 'Author', type: 'text' }]
	},
	{
		name: 'Eat',
		icon: '🍜',
		provider: null,
		fieldSchema: [
			{ key: 'neighborhood', label: 'Neighborhood', type: 'text' },
			{ key: 'price', label: 'Price', type: 'select', options: ['$', '$$', '$$$', '$$$$'] }
		]
	},
	{
		name: 'Visit',
		icon: '📍',
		provider: null,
		fieldSchema: [{ key: 'location', label: 'Location', type: 'text' }]
	},
	{ name: 'Drink', icon: '🍸', provider: null, fieldSchema: [] },
	{
		name: 'Cook',
		icon: '🍳',
		provider: null,
		fieldSchema: [{ key: 'recipe_url', label: 'Recipe', type: 'url' }]
	}
];

/** Seeds the default categories for a new user. Idempotent: does nothing if the user already has categories. */
export function seedDefaultCategories(userId: string, db = getDb()) {
	const existing = db.sqlite
		.prepare('SELECT 1 FROM categories WHERE user_id = ? LIMIT 1')
		.get(userId);
	if (existing) return;
	const now = Date.now();
	DEFAULT_CATEGORIES.forEach((c, i) => {
		db.insert(schema.categories)
			.values({
				id: uuidv7(),
				userId,
				name: c.name,
				icon: c.icon,
				sort: i,
				provider: c.provider,
				fieldSchema: c.fieldSchema,
				createdAt: now,
				updatedAt: now,
				deletedAt: null,
				serverUpdatedAt: monotonicNow()
			})
			.run();
	});
}
