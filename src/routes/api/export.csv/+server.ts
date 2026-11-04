import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { buildExport, toCsv, slug } from '#lib/server/export.ts';
import { APP_NAME } from '#lib/shared/config.ts';

/** GET /api/export.csv?categoryId=<id> → one category as CSV (attachment). */
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const categoryId = event.url.searchParams.get('categoryId');
	if (!categoryId) error(400, 'categoryId is required');
	const file = buildExport(user.id);
	const category = file.categories.find((c) => c.id === categoryId);
	if (!category) error(404, 'Category not found');
	const csv = toCsv(category, file.items, file.logEntries);
	const date = new Date(file.exportedAt).toISOString().slice(0, 10);
	const name = `${APP_NAME.toLowerCase()}-${slug(category.name)}-${date}.csv`;
	return new Response('﻿' + csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${name}"`,
			'cache-control': 'no-store'
		}
	});
};
