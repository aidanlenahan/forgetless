import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { getJob } from '#lib/server/imports/jobs.ts';

/** GET /api/import/apps/jobs/:id → { job: AppImportJob } (only the owner's jobs) */
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const job = getJob(event.params.id, user.id);
	if (!job) error(404, 'Import job not found');
	return json({ job }, { headers: { 'cache-control': 'no-store' } });
};
