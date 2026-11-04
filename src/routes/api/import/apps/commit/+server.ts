import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';
import { getProvider } from '#lib/server/providers/index.ts';
import { stashDelete, stashGet } from '#lib/server/stash.ts';
import { isGuestUser } from '#lib/server/demo.ts';
import { env } from '#lib/server/env.ts';
import { getDb } from '#lib/server/db/index.ts';
import { countDuplicates, startAppImport } from '#lib/server/imports/jobs.ts';
import { AppImportError, type ParsedImport } from '#lib/server/imports/types.ts';
import type { AppImportCommitRequest } from '#lib/shared/types.ts';

/**
 * POST /api/import/apps/commit { previewId, categoryId | 'new', duplicates?: 'skip'|'merge' }
 * → 202 { job: AppImportJob }. Poll GET /api/import/apps/jobs/:id for progress.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const limited = rateLimit([limits.appImportUser, user.id]);
	if (limited) return limited;
	const body = (await event.request.json().catch(() => null)) as AppImportCommitRequest | null;
	if (!body || typeof body.previewId !== 'string' || typeof body.categoryId !== 'string')
		error(400, 'Expected { previewId, categoryId }');
	const parsed = stashGet<ParsedImport>(body.previewId, user.id, 'app-import');
	if (!parsed) error(410, 'This preview has expired. Upload the file again.');
	const duplicates = body.duplicates === 'merge' ? 'merge' : 'skip';

	const guest = !!user.isGuest || isGuestUser(user.id);
	const db = getDb();
	if (guest) {
		// Fail early when the import can't fit; the job also stops at the cap.
		const { n } = db.sqlite
			.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND deleted_at IS NULL')
			.get(user.id) as { n: number };
		const dups =
			body.categoryId === 'new' ? 0 : countDuplicates(user.id, body.categoryId, parsed.records, db);
		if (n + parsed.records.length - dups > env.guestItemCap)
			error(403, `Demo accounts are limited to ${env.guestItemCap} items`);
	}
	try {
		const { job } = startAppImport({
			userId: user.id,
			parsed,
			categoryId: body.categoryId,
			duplicates,
			provider: getProvider('tmdb'),
			db,
			itemCap: guest ? env.guestItemCap : null
		});
		stashDelete(body.previewId);
		return json({ job }, { status: 202 });
	} catch (e) {
		if (e instanceof AppImportError) error(e.status, e.message);
		throw e;
	}
};
