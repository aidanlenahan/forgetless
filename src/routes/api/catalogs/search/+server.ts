import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';
import { searchCatalogs } from '#lib/server/catalogs.ts';

/**
 * GET /api/catalogs/search?categoryId=<id>&q=<text>&limit=10 → { entries: CatalogEntry[] }
 * Searches the signed-in user's catalogs attached to that category (never anyone else's).
 */
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const categoryId = event.url.searchParams.get('categoryId');
	if (!categoryId) error(400, 'categoryId is required');
	const q = (event.url.searchParams.get('q') ?? '').trim().slice(0, 100);
	if (!q) return json({ entries: [] });
	const limited = rateLimit([limits.catalogSearchUser, user.id]);
	if (limited) return limited;
	const limit = Math.min(20, Math.max(1, Number(event.url.searchParams.get('limit')) || 10));
	return json(
		{ entries: searchCatalogs(user.id, categoryId, q, limit) },
		{ headers: { 'cache-control': 'private, no-store' } }
	);
};
