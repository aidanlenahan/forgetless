import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { readUploads } from '#lib/server/upload.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';
import { getProvider } from '#lib/server/providers/index.ts';
import { stashPut } from '#lib/server/stash.ts';
import { APP_IMPORT_MAX_BYTES, expandUploads, parseAppImport } from '#lib/server/imports/detect.ts';
import { buildPreview } from '#lib/server/imports/jobs.ts';
import { AppImportError, type ParsedImport } from '#lib/server/imports/types.ts';
import type { AppImportPreview, AppImportSource } from '#lib/shared/types.ts';

const SOURCES: AppImportSource[] = ['letterboxd', 'imdb', 'goodreads'];

/**
 * POST /api/import/apps/preview  multipart: file (one or more CSVs, or a ZIP), source? (letterboxd|imdb|goodreads)
 * → AppImportPreview. The parsed rows are kept server-side for 30 minutes under previewId.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const limited = rateLimit([limits.appImportUser, user.id]);
	if (limited) return limited;
	const { files, fields } = await readUploads(event, APP_IMPORT_MAX_BYTES);
	const source = SOURCES.find((s) => s === fields.source);
	let parsed: ParsedImport;
	try {
		parsed = parseAppImport(expandUploads(files), source);
	} catch (e) {
		if (e instanceof AppImportError) error(e.status, e.message);
		throw e;
	}
	const preview = buildPreview(user.id, parsed, { matching: !!getProvider('tmdb') });
	const previewId = stashPut(user.id, 'app-import', parsed);
	return json({ previewId, ...preview } satisfies AppImportPreview);
};
