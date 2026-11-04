// Client side of user catalogs (autocomplete sources per category). Server: src/routes/api/catalogs/*.
// Search is server-side only (needs a connection); `catalogIndex` remembers which categories have
// catalogs so quick capture only queries those.
import { apiJson } from './imports';
import type {
	Catalog,
	CatalogEntry,
	CatalogMapping,
	CatalogPreview,
	Category
} from '../shared/types';

export const catalogIndex = $state({
	loaded: false,
	byCategory: {} as Record<string, Catalog[]>
});

let loading: Promise<void> | null = null;

/** Loads (or reloads) the list of the user's catalogs. Errors (offline) leave the old index. */
export function refreshCatalogs(force = false): Promise<void> {
	if (loading) return loading;
	if (catalogIndex.loaded && !force) return Promise.resolve();
	loading = (async () => {
		try {
			const { catalogs } = await apiJson<{ catalogs: Catalog[] }>(await fetch('/api/catalogs'));
			const by: Record<string, Catalog[]> = {};
			for (const c of catalogs) (by[c.categoryId] ??= []).push(c);
			catalogIndex.byCategory = by;
			catalogIndex.loaded = true;
		} catch {
			/* offline: keep what we have */
		} finally {
			loading = null;
		}
	})();
	return loading;
}

export function hasCatalogs(categoryId: string | null | undefined): boolean {
	return !!categoryId && (catalogIndex.byCategory[categoryId]?.length ?? 0) > 0;
}

export async function searchCatalogs(
	categoryId: string,
	q: string,
	signal?: AbortSignal
): Promise<CatalogEntry[]> {
	const r = await fetch(
		`/api/catalogs/search?categoryId=${encodeURIComponent(categoryId)}&q=${encodeURIComponent(q)}`,
		{ signal }
	);
	return (await apiJson<{ entries: CatalogEntry[] }>(r)).entries;
}

/** Mapped extra columns of a catalog row, ready to copy into item.customFields. */
export function catalogFields(e: CatalogEntry | null | undefined): Record<string, unknown> {
	const f = (e?.data as { fields?: unknown } | undefined)?.fields;
	return f && typeof f === 'object' && !Array.isArray(f)
		? { ...(f as Record<string, unknown>) }
		: {};
}

export async function previewCatalog(file: File): Promise<CatalogPreview> {
	const form = new FormData();
	form.append('file', file, file.name);
	return apiJson(await fetch('/api/catalogs/preview', { method: 'POST', body: form }));
}

export async function createCatalog(req: {
	previewId: string;
	categoryId: string;
	name: string;
	mapping: CatalogMapping;
	addFields: boolean;
}): Promise<{ catalog: Catalog; category: Category }> {
	const r = await fetch('/api/catalogs', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(req)
	});
	const res = await apiJson<{ catalog: Catalog; category: Category }>(r);
	await refreshCatalogs(true);
	return res;
}

export async function deleteCatalog(id: string): Promise<void> {
	await apiJson(await fetch(`/api/catalogs/${encodeURIComponent(id)}`, { method: 'DELETE' }));
	await refreshCatalogs(true);
}
