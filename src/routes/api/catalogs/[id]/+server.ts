import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';
import { deleteCatalog } from '#lib/server/catalogs.ts';

/** DELETE /api/catalogs/:id → { ok: true } */
export const DELETE: RequestHandler = (event) => {
	const user = requireUser(event);
	const limited = rateLimit([limits.catalogWriteUser, user.id]);
	if (limited) return limited;
	if (!deleteCatalog(user.id, event.params.id)) error(404, 'Catalog not found');
	return json({ ok: true });
};
