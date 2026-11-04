import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { pull, applyMutations, MutationError } from '#lib/server/repo.ts';
import type { SyncPushRequest } from '#lib/shared/types.ts';

/** GET /api/sync?since=<cursor> → changed rows since cursor (0 = everything). */
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const since = Number(event.url.searchParams.get('since') ?? 0) || 0;
	return json(pull(user.id, since));
};

/** POST /api/sync { mutations } → upsert by id, last-write-wins on updatedAt. */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = (await event.request.json().catch(() => null)) as SyncPushRequest | null;
	if (!body || !Array.isArray(body.mutations)) error(400, 'Expected { mutations: [] }');
	if (body.mutations.length > 1000) error(413, 'Too many mutations in one batch');
	try {
		return json(applyMutations(user.id, body.mutations));
	} catch (e: unknown) {
		if (e instanceof MutationError) error(400, e.message);
		throw e;
	}
};
