import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { buildExport } from '#lib/server/export.ts';
import { APP_NAME } from '#lib/shared/config.ts';

/** GET /api/export.json → ExportFile (attachment). Non-deleted rows + referenced catalog entries. */
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const file = buildExport(user.id);
	const name = `${APP_NAME.toLowerCase()}-export-${new Date(file.exportedAt).toISOString().slice(0, 10)}.json`;
	return new Response(JSON.stringify(file, null, 2), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="${name}"`,
			'cache-control': 'no-store'
		}
	});
};
