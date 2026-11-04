// multipart/form-data upload reading with a size cap (files in field "file", other fields as strings).
import { error, type RequestEvent } from '@sveltejs/kit';

export interface Upload {
	files: { name: string; data: Uint8Array }[];
	fields: Record<string, string>;
}

export async function readUploads(
	event: Pick<RequestEvent, 'request'>,
	maxBytes: number
): Promise<Upload> {
	const mb = Math.round(maxBytes / 1024 / 1024);
	const len = Number(event.request.headers.get('content-length') ?? 0);
	if (len > maxBytes + 64 * 1024) error(413, `Upload is too large (max ${mb} MB)`);
	if (!(event.request.headers.get('content-type') ?? '').includes('multipart/form-data'))
		error(400, 'Expected a multipart/form-data upload');
	let form: FormData;
	try {
		form = await event.request.formData();
	} catch {
		error(400, 'Could not read the upload');
	}
	const files: Upload['files'] = [];
	const fields: Record<string, string> = {};
	let total = 0;
	for (const [k, v] of form.entries()) {
		if (typeof v === 'string') {
			fields[k] = v.slice(0, 1000);
			continue;
		}
		total += v.size;
		if (total > maxBytes) error(413, `Upload is too large (max ${mb} MB)`);
		files.push({ name: v.name || 'upload', data: new Uint8Array(await v.arrayBuffer()) });
	}
	if (!files.length) error(400, 'No file uploaded');
	if (files.length > 20) error(400, 'Too many files (max 20)');
	return { files, fields };
}
