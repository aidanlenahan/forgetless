import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { importExport, ImportError, IMPORT_MAX_BYTES, type ImportMode } from '#lib/server/export.ts';
import { MutationError } from '#lib/server/repo.ts';
import { isGuestUser } from '#lib/server/demo.ts';
import { env } from '#lib/server/env.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';

/**
 * POST /api/import?mode=merge|replace  body: ExportFile JSON (application/json, max 10 MB)
 * → { applied, skipped }
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const modeParam = event.url.searchParams.get('mode') ?? 'merge';
	if (modeParam !== 'merge' && modeParam !== 'replace') error(400, 'mode must be merge or replace');
	const mode: ImportMode = modeParam;

	const len = Number(event.request.headers.get('content-length') ?? 0);
	if (len > IMPORT_MAX_BYTES) error(413, 'Import file is too large (max 10 MB)');

	const limited = rateLimit([limits.importUser, user.id]);
	if (limited) return limited;

	const text = await event.request.text();
	if (text.length > IMPORT_MAX_BYTES) error(413, 'Import file is too large (max 10 MB)');
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		error(400, 'Invalid JSON');
	}
	const guest = user.isGuest || isGuestUser(user.id);
	try {
		return json(importExport(user.id, body, mode, undefined, guest ? { itemCap: env.guestItemCap } : {}));
	} catch (e) {
		if (e instanceof ImportError) error(e.status, e.message);
		if (e instanceof MutationError) error(400, `Invalid row: ${e.message}`);
		throw e;
	}
};
