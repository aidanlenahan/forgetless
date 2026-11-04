import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';
import { stashDelete, stashGet } from '#lib/server/stash.ts';
import { isGuestUser } from '#lib/server/demo.ts';
import {
	CATALOG_GUEST_MAX_ROWS,
	CatalogError,
	createCatalog,
	listCatalogs,
	type CatalogTable
} from '#lib/server/catalogs.ts';
import type { CatalogMapping } from '#lib/shared/types.ts';

/** GET /api/catalogs?categoryId=<id> → { catalogs: Catalog[] } (all of the user's when omitted) */
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const categoryId = event.url.searchParams.get('categoryId');
	return json({ catalogs: listCatalogs(user.id, categoryId) });
};

/**
 * POST /api/catalogs { previewId, categoryId, name, mapping: CatalogMapping, addFields?: boolean }
 * → 201 { catalog: Catalog, category: Category }. `category` reflects any fields added to its schema.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const limited = rateLimit([limits.catalogWriteUser, user.id]);
	if (limited) return limited;
	const body = (await event.request.json().catch(() => null)) as {
		previewId?: unknown;
		categoryId?: unknown;
		name?: unknown;
		mapping?: CatalogMapping;
		addFields?: unknown;
	} | null;
	if (
		!body ||
		typeof body.previewId !== 'string' ||
		typeof body.categoryId !== 'string' ||
		typeof body.name !== 'string' ||
		!body.mapping ||
		typeof body.mapping !== 'object' ||
		typeof body.mapping.title !== 'string'
	)
		error(400, 'Expected { previewId, categoryId, name, mapping: { title, … } }');
	const table = stashGet<CatalogTable>(body.previewId, user.id, 'catalog');
	if (!table) error(410, 'This preview has expired. Upload the file again.');
	const guest = !!user.isGuest || isGuestUser(user.id);
	try {
		const res = createCatalog(user.id, {
			categoryId: body.categoryId,
			name: body.name,
			mapping: body.mapping,
			table,
			addFields: body.addFields === true,
			maxRows: guest ? CATALOG_GUEST_MAX_ROWS : undefined
		});
		stashDelete(body.previewId);
		return json(res, { status: 201 });
	} catch (e) {
		if (e instanceof CatalogError) error(e.status, e.message);
		throw e;
	}
};
