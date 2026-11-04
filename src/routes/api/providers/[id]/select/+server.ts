import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { getProvider, selectEntry, ProviderError } from '#lib/server/providers/index.ts';
import { limits, rateLimit } from '#lib/server/ratelimit.ts';

/** POST /api/providers/:id/select { externalId, kind } → { entry: CatalogEntry } */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const provider = getProvider(event.params.id);
	if (!provider) error(404, 'Provider not enabled');
	const body = (await event.request.json().catch(() => null)) as { externalId?: unknown; kind?: unknown } | null;
	const externalId = typeof body?.externalId === 'string' ? body.externalId.trim() : '';
	const kind = typeof body?.kind === 'string' ? body.kind : undefined;
	if (!externalId || externalId.length > 100) error(400, 'Expected { externalId, kind }');
	if (kind && !provider.kinds.includes(kind)) error(400, `Unknown kind for ${provider.id}`);

	const limited = rateLimit([limits.providerSelectUser, user.id]);
	if (limited) return limited;
	try {
		return json({ entry: await selectEntry(provider, externalId, kind) });
	} catch (e) {
		if (e instanceof ProviderError) error(e.status, e.message);
		throw e;
	}
};
