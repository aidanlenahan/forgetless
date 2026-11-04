// Small RFC 4180 CSV reader/writer shared by exports, app imports and catalogs.
// Handles quoted fields (with "" escapes and embedded newlines), CRLF / LF / CR line endings, a leading
// BOM, and other delimiters (';' and tab via sniffDelimiter).

/** Parses CSV text into rows of fields. Fully empty lines are dropped. */
export function parseCsv(text: string, delimiter = ','): string[][] {
	const rows: string[][] = [];
	const n = text.length;
	let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	let row: string[] = [];
	const endRow = () => {
		if (row.length > 1 || row[0] !== '') rows.push(row);
		row = [];
	};
	while (i < n) {
		let field: string;
		if (text[i] === '"') {
			// Quoted field: copy chunks between quotes, "" is an escaped quote.
			let out = '';
			let j = i + 1;
			for (;;) {
				const q = text.indexOf('"', j);
				if (q === -1) {
					out += text.slice(j);
					j = n;
					break;
				}
				out += text.slice(j, q);
				if (text[q + 1] === '"') {
					out += '"';
					j = q + 2;
				} else {
					j = q + 1;
					break;
				}
			}
			// Anything after the closing quote up to the delimiter is kept (lenient).
			let k = j;
			while (k < n && text[k] !== delimiter && text[k] !== '\n' && text[k] !== '\r') k++;
			field = out + text.slice(j, k);
			i = k;
		} else {
			let k = i;
			while (k < n && text[k] !== delimiter && text[k] !== '\n' && text[k] !== '\r') k++;
			field = text.slice(i, k);
			i = k;
		}
		row.push(field);
		if (i >= n) break;
		const c = text[i];
		if (c === delimiter) {
			i++;
			if (i >= n) row.push('');
		} else {
			i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
			endRow();
		}
	}
	if (row.length) endRow();
	return rows;
}

/** Guesses the delimiter from the first line (outside quotes): ',', ';' or tab. */
export function sniffDelimiter(text: string): string {
	const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
	let quoted = false;
	for (let i = 0; i < text.length && i < 10_000; i++) {
		const c = text[i];
		if (c === '"') quoted = !quoted;
		else if (!quoted && (c === '\n' || c === '\r')) break;
		else if (!quoted && c in counts) counts[c]++;
	}
	const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
	return n > 0 ? best : ',';
}

export interface CsvTable {
	headers: string[];
	rows: Record<string, string>[];
}

/** First row = headers (trimmed). Each following row becomes an object keyed by header. */
export function csvRecords(text: string, delimiter = ','): CsvTable {
	const all = parseCsv(text, delimiter);
	if (!all.length) return { headers: [], rows: [] };
	const headers = all[0].map((h) => h.trim());
	const rows = all.slice(1).map((r) => {
		const o: Record<string, string> = {};
		headers.forEach((h, j) => {
			if (h && !(h in o)) o[h] = r[j] ?? '';
		});
		return o;
	});
	return { headers, rows };
}

/** Strips Excel's `="..."` text wrapper (Goodreads uses it for ISBNs). */
export function unwrapExcel(v: string | null | undefined): string {
	const s = (v ?? '').trim();
	const m = /^="(.*)"$/s.exec(s);
	return m ? m[1].trim() : s;
}

/** RFC 4180 field escaping, plus a guard against spreadsheet formula injection for text values. */
export function csvField(v: unknown): string {
	if (v == null) return '';
	let s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
	if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: unknown[]): string {
	return values.map(csvField).join(',');
}
