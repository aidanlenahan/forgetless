// App import preview + background job. A job matches records against the provider and writes items and
// log entries through repo.applyMutations in small batches; progress is polled by the client.
// Jobs live in memory (single-instance app), keyed by id and checked against the owner.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb, schema, type DB } from '../db';
import { applyMutations, toCategory, toItems, toLogEntry } from '../repo';
import type { Provider } from '../providers';
import type {
	AppImportJob,
	AppImportPreview,
	AppImportSource,
	Category,
	FieldDef,
	Item,
	LogEntry,
	Mutation,
	Status
} from '../../shared/types';
import { STATUSES } from '../../shared/types';
import { AppImportError, type ImportRecord, type ParsedImport } from './types';
import { mapLimit, matchable, matchRecord, type MatchOptions } from './match';
import { normTitle } from './util';

const BATCH = 25;
const CONCURRENCY = 4;

// ---------- categories ----------

const DEFAULT_TARGET: Record<
	AppImportSource,
	{ name: string; icon: string; provider: string | null; fields: FieldDef[] }
> = {
	letterboxd: { name: 'Watch', icon: '🎬', provider: 'tmdb', fields: [] },
	imdb: { name: 'Watch', icon: '🎬', provider: 'tmdb', fields: [] },
	goodreads: {
		name: 'Read',
		icon: '📚',
		provider: null,
		fields: [{ key: 'author', label: 'Author', type: 'text' }]
	}
};

export function liveCategories(userId: string, db: DB): Category[] {
	return db
		.select()
		.from(schema.categories)
		.where(and(eq(schema.categories.userId, userId), isNull(schema.categories.deletedAt)))
		.all()
		.map(toCategory)
		.sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);
}

/** Watch-like (TMDB) category for films, Read-like for books. */
export function suggestCategory(cats: Category[], source: AppImportSource): Category | null {
	const byName = (re: RegExp) => cats.find((c) => re.test(c.name.trim()));
	if (source === 'goodreads') return byName(/^read$/i) ?? byName(/book|read/i) ?? null;
	return (
		cats.find((c) => c.provider === 'tmdb') ??
		byName(/^watch$/i) ??
		byName(/film|movie|watch/i) ??
		null
	);
}

// ---------- duplicates ----------

interface Known {
	item: Item;
	year: number | null;
}

const isLink = (s: string | null | undefined): s is string => !!s && /^https?:\/\//.test(s);
const host = (s: string) => {
	try {
		return new URL(s).hostname;
	} catch {
		return s;
	}
};
/** Two different links on the same site (two boxd.it films) are two different things. */
const distinctLinks = (a: string | null | undefined, b: string | null | undefined) =>
	isLink(a) && isLink(b) && a !== b && host(a) === host(b);

/**
 * Finds an item in the target category: by catalog entry, by source link (e.g. the same Letterboxd or
 * Goodreads URL), or by normalised title with the year within ±1. Title matches whose source links
 * point at different pages of the same site (remakes on Letterboxd) are ignored.
 */
export class DupIndex {
	private byTitle = new Map<string, Known[]>();
	private byEntry = new Map<string, Item>();
	private bySource = new Map<string, Item>();
	add(item: Item, year: number | null, titles: string[] = [item.title]) {
		for (const t of new Set(titles.map(normTitle))) {
			const arr = this.byTitle.get(t) ?? [];
			arr.push({ item, year });
			this.byTitle.set(t, arr);
		}
		if (item.catalogEntryId) this.byEntry.set(item.catalogEntryId, item);
		if (isLink(item.source)) this.bySource.set(item.source, item);
	}
	find(
		title: string,
		year: number | null,
		entryId?: string | null,
		source?: string | null
	): Item | null {
		const hit =
			(entryId && this.byEntry.get(entryId)) || (isLink(source) && this.bySource.get(source));
		if (hit) return hit;
		const arr = this.byTitle.get(normTitle(title)) ?? [];
		const k = arr.find(
			(x) =>
				(x.year == null || year == null || Math.abs(x.year - year) <= 1) &&
				!distinctLinks(source, x.item.source)
		);
		return k?.item ?? null;
	}
}

export function categoryIndex(userId: string, categoryId: string, db: DB): DupIndex {
	const rows = db
		.select()
		.from(schema.items)
		.where(
			and(
				eq(schema.items.userId, userId),
				eq(schema.items.categoryId, categoryId),
				isNull(schema.items.deletedAt)
			)
		)
		.all();
	const items = toItems(db, rows);
	const entryIds = [...new Set(items.map((i) => i.catalogEntryId).filter((x): x is string => !!x))];
	const years = new Map<string, { year: number | null; title: string }>();
	for (let i = 0; i < entryIds.length; i += 500) {
		for (const e of db
			.select()
			.from(schema.catalogEntries)
			.where(inArray(schema.catalogEntries.id, entryIds.slice(i, i + 500)))
			.all())
			years.set(e.id, { year: e.year, title: e.title });
	}
	const idx = new DupIndex();
	for (const it of items) {
		const e = it.catalogEntryId ? years.get(it.catalogEntryId) : undefined;
		idx.add(it, e?.year ?? null, e ? [it.title, e.title] : [it.title]);
	}
	return idx;
}

// ---------- preview ----------

export function buildPreview(
	userId: string,
	parsed: ParsedImport,
	opts: { db?: DB; matching: boolean }
): Omit<AppImportPreview, 'previewId'> {
	const db = opts.db ?? getDb();
	const target = suggestCategory(liveCategories(userId, db), parsed.source);
	const idx = target ? categoryIndex(userId, target.id, db) : null;
	const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
	let logs = 0;
	const dupTitles: string[] = [];
	const dup = new Set<ImportRecord>();
	for (const r of parsed.records) {
		byStatus[r.status]++;
		logs += r.logs.length;
		if (idx?.find(r.title, r.year, null, r.source)) {
			dup.add(r);
			if (dupTitles.length < 10) dupTitles.push(r.title);
		}
	}
	return {
		source: parsed.source,
		files: parsed.files,
		warnings: parsed.warnings,
		counts: { items: parsed.records.length, logEntries: logs, byStatus },
		categoryId: target?.id ?? null,
		newCategoryName: DEFAULT_TARGET[parsed.source].name,
		duplicates: dup.size,
		duplicateTitles: dupTitles,
		samples: parsed.records.slice(0, 8).map((r) => ({
			title: r.title,
			year: r.year,
			status: r.status,
			logs: r.logs.length,
			rating: r.logs.find((l) => l.rating != null)?.rating ?? null,
			duplicate: dup.has(r)
		})),
		matching: opts.matching && parsed.records.some(matchable)
	};
}

/** Duplicate count against an arbitrary category (the user may pick another target than suggested). */
export function countDuplicates(
	userId: string,
	categoryId: string,
	records: ImportRecord[],
	db: DB = getDb()
): number {
	const idx = categoryIndex(userId, categoryId, db);
	return records.filter((r) => idx.find(r.title, r.year, null, r.source)).length;
}

// ---------- jobs ----------

interface JobRow extends AppImportJob {
	userId: string;
}
const g = globalThis as unknown as { __appImportJobs?: Map<string, JobRow> };
const jobs = () => (g.__appImportJobs ??= new Map());

const publicJob = ({ userId: _u, ...j }: JobRow): AppImportJob => ({ ...j });

export function getJob(id: string, userId: string): AppImportJob | null {
	const j = jobs().get(id);
	return j && j.userId === userId ? publicJob(j) : null;
}

function sweepJobs(now: number) {
	for (const [id, j] of jobs())
		if (j.finishedAt && now - j.finishedAt > 60 * 60 * 1000) jobs().delete(id);
}

export function runningJobFor(userId: string): AppImportJob | null {
	for (const j of jobs().values())
		if (j.userId === userId && j.status === 'running') return publicJob(j);
	return null;
}

/** Resolves the target category, creating it ('new') or adding the author field (Goodreads) as needed. */
export function prepareCategory(
	userId: string,
	source: AppImportSource,
	categoryId: string,
	db: DB,
	now = Date.now()
): Category {
	const def = DEFAULT_TARGET[source];
	if (categoryId === 'new') {
		const cats = liveCategories(userId, db);
		const c: Category = {
			id: uuidv7(),
			name: def.name,
			icon: def.icon,
			sort: cats.length,
			provider: def.provider,
			fieldSchema: def.fields,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
		applyMutations(userId, [{ kind: 'category', row: c }], db);
		return c;
	}
	const row = db
		.select()
		.from(schema.categories)
		.where(and(eq(schema.categories.id, categoryId), eq(schema.categories.userId, userId)))
		.get();
	if (!row || row.deletedAt) throw new AppImportError('Category not found', 404);
	const cat = toCategory(row);
	const missing = def.fields.filter((f) => !cat.fieldSchema.some((x) => x.key === f.key));
	if (missing.length) {
		const next = { ...cat, fieldSchema: [...cat.fieldSchema, ...missing], updatedAt: now };
		applyMutations(userId, [{ kind: 'category', row: next }], db);
		return next;
	}
	return cat;
}

export interface StartOptions {
	userId: string;
	parsed: ParsedImport;
	categoryId: string;
	duplicates?: 'skip' | 'merge';
	provider: Provider | null;
	db?: DB;
	/** max live items the user may have (guest accounts) */
	itemCap?: number | null;
	matchOptions?: Partial<MatchOptions>;
}

/** Creates the job and starts it in the background. `done` resolves when it finishes (for tests). */
export function startAppImport(opts: StartOptions): { job: AppImportJob; done: Promise<void> } {
	const db = opts.db ?? getDb();
	const now = Date.now();
	sweepJobs(now);
	if (runningJobFor(opts.userId)) throw new AppImportError('An import is already running', 409);
	const category = prepareCategory(opts.userId, opts.parsed.source, opts.categoryId, db, now);
	const job: JobRow = {
		id: uuidv7(),
		userId: opts.userId,
		status: 'running',
		source: opts.parsed.source,
		categoryId: category.id,
		total: opts.parsed.records.length,
		done: 0,
		created: 0,
		matched: 0,
		unmatched: 0,
		skippedDuplicates: 0,
		merged: 0,
		logEntries: 0,
		error: null,
		startedAt: now,
		finishedAt: null
	};
	jobs().set(job.id, job);
	const done = runJob(job, { ...opts, db, category })
		.catch((e: unknown) => {
			job.status = 'error';
			job.error = e instanceof Error ? e.message : String(e);
			if (!(e instanceof AppImportError)) console.error('[import] job failed', e);
		})
		.finally(() => {
			job.finishedAt = Date.now();
		});
	return { job: publicJob(job), done };
}

const STATUS_RANK: Record<Status, number> = { dropped: 0, want: 1, in_progress: 2, done: 3 };
const yieldTick = () => new Promise<void>((r) => setImmediate(r));

async function runJob(
	job: JobRow,
	ctx: StartOptions & { db: DB; category: Category }
): Promise<void> {
	const { db, userId, category, provider } = ctx;
	const mode = ctx.duplicates ?? 'skip';
	const records = ctx.parsed.records;
	const idx = categoryIndex(userId, category.id, db);
	const createdHere = new Set<string>();
	const logCache = new Map<string, LogEntry[]>();
	const { n: liveCount } = db.sqlite
		.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND deleted_at IS NULL')
		.get(userId) as { n: number };

	const logsOf = (itemId: string): LogEntry[] => {
		let l = logCache.get(itemId);
		if (!l) {
			l = db
				.select()
				.from(schema.logEntries)
				.where(and(eq(schema.logEntries.itemId, itemId), isNull(schema.logEntries.deletedAt)))
				.all()
				.map(toLogEntry);
			logCache.set(itemId, l);
		}
		return l;
	};

	const logMutations = (itemId: string, rec: ImportRecord, now: number): Mutation[] => {
		const have = logsOf(itemId);
		const out: Mutation[] = [];
		for (const l of rec.logs) {
			if (have.some((h) => h.date === l.date && (h.rating ?? null) === (l.rating ?? null)))
				continue;
			const row: LogEntry = {
				id: uuidv7(),
				itemId,
				date: l.date,
				rating: l.rating,
				note: l.note,
				createdAt: now,
				updatedAt: now,
				deletedAt: null
			};
			have.push(row);
			out.push({ kind: 'logEntry', row });
		}
		return out;
	};

	for (let start = 0; start < records.length; start += BATCH) {
		const chunk = records.slice(start, start + BATCH);
		// Title duplicates are known before matching; don't spend provider calls on them.
		const entries = await mapLimit(chunk, CONCURRENCY, async (rec) => {
			const pre = idx.find(rec.title, rec.year, null, rec.source);
			if (pre && (mode === 'skip' || !matchable(rec))) return null;
			return matchRecord(rec, { db, provider, ...ctx.matchOptions });
		});
		const now = Date.now();
		const mutations: Mutation[] = [];
		let capped = false;
		chunk.forEach((rec, i) => {
			if (capped) return;
			const entry = entries[i];
			const dup =
				idx.find(rec.title, rec.year, entry?.id, rec.source) ??
				(entry ? idx.find(entry.title, entry.year ?? rec.year, null, rec.source) : null);
			job.done++;
			if (dup) {
				const mine = createdHere.has(dup.id);
				if (mode === 'skip' && !mine) {
					job.skippedDuplicates++;
					return;
				}
				const logs = logMutations(dup.id, rec, now);
				const status =
					STATUS_RANK[rec.status] > STATUS_RANK[dup.status] && dup.status !== 'dropped'
						? rec.status
						: dup.status;
				const tags = [...new Set([...dup.tags, ...rec.tags])];
				const linkEntry = !dup.catalogEntryId && entry ? entry.id : dup.catalogEntryId;
				if (
					status !== dup.status ||
					tags.length !== dup.tags.length ||
					linkEntry !== dup.catalogEntryId
				) {
					Object.assign(dup, {
						status,
						tags,
						catalogEntryId: linkEntry,
						needsMatch: linkEntry ? false : dup.needsMatch,
						updatedAt: now
					});
					mutations.push({ kind: 'item', row: { ...dup } });
				}
				mutations.push(...logs);
				job.logEntries += logs.length;
				if (!mine) job.merged++;
				return;
			}
			if (ctx.itemCap != null && liveCount + job.created >= ctx.itemCap) {
				capped = true;
				job.done--;
				return;
			}
			const needsMatch = matchable(rec) && !entry;
			const item: Item = {
				id: uuidv7(),
				categoryId: category.id,
				catalogEntryId: entry?.id ?? null,
				title: entry?.title ?? rec.title,
				status: rec.status,
				recommendedBy: null,
				source: rec.source,
				why: rec.why,
				tags: rec.tags,
				customFields: rec.customFields,
				needsMatch,
				createdAt: rec.addedAt ?? now,
				updatedAt: now,
				deletedAt: null
			};
			logCache.set(item.id, []);
			mutations.push({ kind: 'item', row: item }, ...logMutations(item.id, rec, now));
			job.logEntries += rec.logs.length;
			createdHere.add(item.id);
			idx.add(item, entry?.year ?? rec.year, [rec.title, item.title]);
			job.created++;
			if (entry) job.matched++;
			if (needsMatch) job.unmatched++;
		});
		if (mutations.length) applyMutations(userId, mutations, db);
		if (capped)
			throw new AppImportError(
				`This account is limited to ${ctx.itemCap} items; the import stopped after ${job.created} new items.`,
				403
			);
		await yieldTick();
	}
	job.status = 'done';
}
