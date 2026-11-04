// Client calls for app imports (Letterboxd / IMDb / Goodreads). Server: src/routes/api/import/apps/*.
import type {
	AppImportCommitRequest,
	AppImportJob,
	AppImportPreview,
	AppImportSource
} from '../shared/types';

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}

/** Throws ApiError with the server's `message` (SvelteKit error JSON) when the response isn't ok. */
export async function apiJson<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const msg = await res
			.json()
			.then((b: { message?: string }) => b?.message)
			.catch(() => null);
		throw new ApiError(
			msg ||
				(res.status === 429
					? 'Too many requests, try again later'
					: `Request failed (${res.status})`),
			res.status
		);
	}
	return (await res.json()) as T;
}

export const APP_IMPORT_MAX_MB = 20;

export async function previewAppImport(
	files: File[],
	source?: AppImportSource
): Promise<AppImportPreview> {
	const form = new FormData();
	for (const f of files) form.append('file', f, f.name);
	if (source) form.append('source', source);
	return apiJson(await fetch('/api/import/apps/preview', { method: 'POST', body: form }));
}

export async function commitAppImport(req: AppImportCommitRequest): Promise<AppImportJob> {
	const r = await fetch('/api/import/apps/commit', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(req)
	});
	return (await apiJson<{ job: AppImportJob }>(r)).job;
}

export async function getImportJob(id: string): Promise<AppImportJob> {
	const r = await fetch(`/api/import/apps/jobs/${encodeURIComponent(id)}`);
	return (await apiJson<{ job: AppImportJob }>(r)).job;
}
