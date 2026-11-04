import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { searchItems } from '#lib/server/repo.ts';

/** GET /api/search?q=...&limit=50 → { ids: string[] } (FTS over the user's own items, best first) */
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const q = (event.url.searchParams.get('q') ?? '').slice(0, 200);
	const limit = Math.min(200, Math.max(1, Number(event.url.searchParams.get('limit')) || 50));
	return json({ ids: q.trim() ? searchItems(user.id, q, limit) : [] });
};
