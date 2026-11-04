// Turns uploaded files (CSV or ZIP) into a ParsedImport: unzip, decode, detect the app by headers and
// filenames, then hand off to the app's parser.
import { unzipSync } from 'fflate';
import { csvRecords, type CsvTable } from '../../shared/csv';
import { APP_IMPORT_LABELS, type AppImportSource } from '../../shared/types';
import { AppImportError, type CsvFile, type ParsedImport } from './types';
import { letterboxdFileKind, letterboxdImport, type LetterboxdFile } from './letterboxd';
import { imdbFileKind, imdbImport, type ImdbFile } from './imdb';
import { goodreadsImport, isGoodreads } from './goodreads';

export const APP_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024;
export const APP_IMPORT_MAX_RECORDS = 20_000;

/** Letterboxd ZIPs also contain likes/, lists/, deleted/ … whose CSVs look like watched.csv. */
const IGNORED_DIRS = /(^|\/)(likes|lists|deleted|orphaned|__MACOSX)\//i;

export interface UploadedFile {
	name: string;
	data: Uint8Array;
}

const isZip = (d: Uint8Array) => d.length > 3 && d[0] === 0x50 && d[1] === 0x4b && d[2] === 0x03;

/** Expands ZIPs and decodes CSVs (UTF-8, BOM stripped). Non-CSV entries are ignored. */
export function expandUploads(files: UploadedFile[]): CsvFile[] {
	const out: CsvFile[] = [];
	const dec = new TextDecoder('utf-8');
	let total = 0;
	for (const f of files) {
		if (isZip(f.data)) {
			let entries: Record<string, Uint8Array>;
			try {
				entries = unzipSync(f.data, {
					filter: (e) => {
						if (!/\.csv$/i.test(e.name) || IGNORED_DIRS.test(e.name)) return false;
						total += e.originalSize;
						if (total > MAX_UNZIPPED_BYTES)
							throw new AppImportError('The ZIP is too large once unpacked', 413);
						return true;
					}
				});
			} catch (e) {
				if (e instanceof AppImportError) throw e;
				throw new AppImportError(`Could not read ${f.name} as a ZIP file`);
			}
			for (const [name, data] of Object.entries(entries))
				out.push({ name: name.split('/').pop() ?? name, text: dec.decode(data) });
		} else {
			out.push({ name: f.name, text: dec.decode(f.data) });
		}
	}
	return out;
}

type Classified =
	| { app: 'letterboxd'; kind: LetterboxdFile; name: string; table: CsvTable }
	| { app: 'imdb'; kind: ImdbFile; name: string; table: CsvTable }
	| { app: 'goodreads'; name: string; table: CsvTable };

export function classify(file: CsvFile): Classified | null {
	const table = csvRecords(file.text);
	const h = table.headers;
	const lb = letterboxdFileKind(file.name, h);
	if (lb) return { app: 'letterboxd', kind: lb, name: file.name, table };
	if (isGoodreads(h)) return { app: 'goodreads', name: file.name, table };
	const im = imdbFileKind(h);
	if (im) return { app: 'imdb', kind: im, name: file.name, table };
	return null;
}

/** Detects the app and parses. `expected` (the source picked in the UI) turns a mismatch into an error. */
export function parseAppImport(files: CsvFile[], expected?: AppImportSource): ParsedImport {
	if (!files.length) throw new AppImportError('No CSV files found in the upload');
	const known: Classified[] = [];
	const skipped: string[] = [];
	for (const f of files) {
		const c = classify(f);
		if (c) known.push(c);
		else skipped.push(f.name);
	}
	if (!known.length)
		throw new AppImportError(
			"Couldn't recognise these files. Upload the CSV/ZIP exported from Letterboxd, IMDb or Goodreads."
		);
	const apps = [...new Set(known.map((k) => k.app))];
	if (apps.length > 1) throw new AppImportError('Upload files from one app at a time');
	const app = apps[0];
	if (expected && expected !== app)
		throw new AppImportError(
			`These look like ${APP_IMPORT_LABELS[app]} files, not ${APP_IMPORT_LABELS[expected]}`
		);

	let parsed: ParsedImport;
	if (app === 'letterboxd') parsed = letterboxdImport(known.filter((k) => k.app === 'letterboxd'));
	else if (app === 'imdb') parsed = imdbImport(known.filter((k) => k.app === 'imdb'));
	else parsed = goodreadsImport(known);
	// Unknown CSVs inside a Letterboxd ZIP (profile.csv, comments.csv) are expected; only mention loose ones.
	if (skipped.length && app !== 'letterboxd')
		parsed.warnings.push(`Ignored: ${skipped.join(', ')}`);
	if (parsed.records.length > APP_IMPORT_MAX_RECORDS)
		throw new AppImportError(`Too many rows (max ${APP_IMPORT_MAX_RECORDS} per import)`, 413);
	if (!parsed.records.length) throw new AppImportError('The files have no rows to import');
	return parsed;
}
