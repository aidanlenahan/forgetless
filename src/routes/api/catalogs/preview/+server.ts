import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { readUploads } from '#lib/server/upload.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';
import { stashPut } from '#lib/server/stash.ts';
import {
	CATALOG_MAX_BYTES,
	CatalogError,
	parseCatalogUpload,
	suggestMapping
} from '#lib/server/catalogs.ts';
import type { CatalogPreview } from '#lib/shared/types.ts';

/**
 * POST /api/catalogs/preview  multipart: file (CSV or JSON array of objects, max 20 MB)
 * → CatalogPreview { previewId, headers, rows (first 20), rowCount, suggested mapping }
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const limited = rateLimit([limits.catalogWriteUser, user.id]);
	if (limited) return limited;
	const { files } = await readUploads(event, CATALOG_MAX_BYTES);
	const f = files[0];
	try {
		const table = parseCatalogUpload(f.name, new TextDecoder('utf-8').decode(f.data));
		if (!table.headers.length || !table.rows.length) error(400, 'The file has no rows');
		const previewId = stashPut(user.id, 'catalog', table);
		return json({
			previewId,
			headers: table.headers,
			rows: table.rows.slice(0, 20),
			rowCount: table.rows.length,
			suggested: suggestMapping(table.headers)
		} satisfies CatalogPreview);
	} catch (e) {
		if (e instanceof CatalogError) error(e.status, e.message);
		throw e;
	}
};
