import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/guard.ts';
import { getProvider, cachedSearch, ProviderError } from '#lib/server/providers/index.ts';
import { limits, rateLimit, clientIp } from '#lib/server/ratelimit.ts';

/** GET /api/providers/:id/search?q=...&kind=movie|tv → { hits: CatalogHit[] } */
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const provider = getProvider(event.params.id);
	if (!provider) error(404, 'Provider not enabled');
	const q = (event.url.searchParams.get('q') ?? '').trim().slice(0, 200);
	if (q.length < 2) return json({ hits: [] });
	const kind = event.url.searchParams.get('kind') || undefined;
	if (kind && !provider.kinds.includes(kind)) error(400, `Unknown kind for ${provider.id}`);

	const limited = rateLimit(
		[limits.providerSearchUser, user.id],
		[limits.providerSearchIp, clientIp(event)]
	);
	if (limited) return limited;
	try {
		const hits = await cachedSearch(provider, q, { kind });
		return json({ hits }, { headers: { 'cache-control': 'private, max-age=300' } });
	} catch (e) {
		if (e instanceof ProviderError) error(e.status, e.message);
		throw e;
	}
};
