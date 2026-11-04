// Shared entity types used by the server API, the sync protocol and the client (Dexie) store.
export type Status = 'want' | 'in_progress' | 'done' | 'dropped';
export const STATUSES: Status[] = ['want', 'in_progress', 'done', 'dropped'];
export const STATUS_LABELS: Record<Status, string> = {
	want: 'Want',
	in_progress: 'In progress',
	done: 'Done',
	dropped: 'Dropped'
};

export type FieldType = 'text' | 'long_text' | 'number' | 'url' | 'select' | 'date';
export interface FieldDef {
	key: string;
	label: string;
	type: FieldType;
	options?: string[];
}

/** All timestamps are epoch milliseconds. deletedAt != null is a tombstone. */
export interface Category {
	id: string;
	name: string;
	icon: string; // an emoji
	sort: number;
	provider: string | null; // e.g. 'tmdb'
	fieldSchema: FieldDef[];
	createdAt: number;
	updatedAt: number;
	deletedAt: number | null;
}

export interface CatalogEntry {
	id: string;
	source: string; // 'tmdb'
	externalId: string;
	kind: string; // 'movie' | 'tv'
	title: string;
	subtitle: string | null;
	year: number | null;
	imageUrl: string | null;
	data: Record<string, unknown>;
	fetchedAt: number;
}

export interface Item {
	id: string; // uuidv7, client-generated
	categoryId: string;
	catalogEntryId: string | null;
	title: string;
	status: Status;
	recommendedBy: string | null;
	source: string | null;
	why: string | null;
	tags: string[];
	customFields: Record<string, unknown>;
	needsMatch: boolean;
	createdAt: number;
	updatedAt: number;
	deletedAt: number | null;
}

export interface LogEntry {
	id: string; // uuidv7, client-generated
	itemId: string;
	date: string; // YYYY-MM-DD
	rating: number | null; // 1-10 (half stars)
	note: string | null;
	createdAt: number;
	updatedAt: number;
	deletedAt: number | null;
}

/** Sync protocol */
export interface SyncPullResponse {
	cursor: number; // server time; pass back as ?since=
	categories: Category[];
	items: Item[];
	logEntries: LogEntry[];
	catalogEntries: CatalogEntry[];
}

export type Mutation =
	| { kind: 'category'; row: Category }
	| { kind: 'item'; row: Item }
	| { kind: 'logEntry'; row: LogEntry };

export interface SyncPushRequest {
	mutations: Mutation[];
}
export interface SyncPushResponse {
	applied: number;
	skipped: number; // rejected by LWW (server row newer)
}

/** Provider search result (PRD §7) */
export interface CatalogHit {
	source: string;
	externalId: string;
	kind: string;
	title: string;
	subtitle: string | null;
	year: number | null;
	imageUrl: string | null;
}

/** Full-fidelity export format */
export interface ExportFile {
	format: 'forgetless-export';
	version: 1;
	exportedAt: number;
	categories: Category[];
	items: Item[];
	logEntries: LogEntry[];
	catalogEntries: CatalogEntry[];
}

/** A user-imported catalog (autocomplete source for one category). Rows are CatalogEntry rows with
 * source `catalog:<id>`; mapped extra columns live in entry.data.fields and are copied into
 * item.customFields when a hit is picked. */
export interface CatalogFieldMap {
	column: string;
	key: string;
	label: string;
}
export interface CatalogMapping {
	title: string;
	subtitle?: string | null;
	year?: string | null;
	image?: string | null;
	id?: string | null;
	fields: CatalogFieldMap[];
}
export interface Catalog {
	id: string;
	categoryId: string;
	name: string;
	columnMap: CatalogMapping;
	rowCount: number;
	createdAt: number;
	updatedAt: number;
}
export interface CatalogPreview {
	previewId: string;
	headers: string[];
	rows: Record<string, string>[]; // first 20
	rowCount: number;
	suggested: CatalogMapping;
}

/** App imports (Letterboxd / IMDb / Goodreads) */
export type AppImportSource = 'letterboxd' | 'imdb' | 'goodreads';
export const APP_IMPORT_LABELS: Record<AppImportSource, string> = {
	letterboxd: 'Letterboxd',
	imdb: 'IMDb',
	goodreads: 'Goodreads'
};
export interface AppImportSample {
	title: string;
	year: number | null;
	status: Status;
	logs: number;
	rating: number | null;
	duplicate: boolean;
}
export interface AppImportPreview {
	previewId: string;
	source: AppImportSource;
	files: string[];
	warnings: string[];
	counts: { items: number; logEntries: number; byStatus: Record<Status, number> };
	/** suggested target category (null: none fits; the client can ask to create one) */
	categoryId: string | null;
	/** name for a category created when categoryId is 'new' */
	newCategoryName: string;
	/** items whose normalized title already exists in the suggested category */
	duplicates: number;
	duplicateTitles: string[];
	samples: AppImportSample[];
	/** whether provider matching (TMDB) will run */
	matching: boolean;
}
export interface AppImportCommitRequest {
	previewId: string;
	/** existing category id, or 'new' to create one named preview.newCategoryName */
	categoryId: string;
	/** skip (default) or merge log entries into the existing item */
	duplicates?: 'skip' | 'merge';
}
export interface AppImportJob {
	id: string;
	status: 'running' | 'done' | 'error';
	source: AppImportSource;
	categoryId: string;
	total: number;
	done: number;
	created: number;
	matched: number;
	unmatched: number;
	skippedDuplicates: number;
	merged: number;
	logEntries: number;
	error: string | null;
	startedAt: number;
	finishedAt: number | null;
}
