<script lang="ts">
	// Upload → preview summary → choose list → import (server job) → progress → summary.
	import { onDestroy } from 'svelte';
	import FileDrop from './FileDrop.svelte';
	import { store } from '#lib/client/store.svelte.ts';
	import { syncNow, syncStatus } from '#lib/client/sync.ts';
	import {
		APP_IMPORT_MAX_MB,
		commitAppImport,
		getImportJob,
		previewAppImport
	} from '#lib/client/imports.ts';
	import {
		APP_IMPORT_LABELS,
		STATUS_LABELS,
		STATUSES,
		type AppImportJob,
		type AppImportPreview,
		type AppImportSource
	} from '#lib/shared/types.ts';

	let { source }: { source: AppImportSource } = $props();

	type Step = 'pick' | 'uploading' | 'preview' | 'running' | 'done';
	let step = $state<Step>('pick');
	let error = $state('');
	let preview = $state<AppImportPreview | null>(null);
	let target = $state('');
	let dupMode = $state<'skip' | 'merge'>('skip');
	let job = $state<AppImportJob | null>(null);
	let fileNames = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;
	onDestroy(() => {
		if (timer) clearTimeout(timer);
	});

	const label = $derived(APP_IMPORT_LABELS[source]);
	const targetCategory = $derived(
		target && target !== 'new' ? store.categoryById.get(target) : undefined
	);
	const pct = $derived(job && job.total ? Math.round((job.done / job.total) * 100) : 0);
	const doneCategory = $derived(job ? store.categoryById.get(job.categoryId) : undefined);
	const stars = (r: number | null) => (r == null ? '' : `${r / 2}★`);

	async function onFiles(files: File[]) {
		error = '';
		const total = files.reduce((n, f) => n + f.size, 0);
		if (total > APP_IMPORT_MAX_MB * 1024 * 1024) {
			error = `That's more than ${APP_IMPORT_MAX_MB} MB.`;
			return;
		}
		fileNames = files.map((f) => f.name).join(', ');
		step = 'uploading';
		try {
			preview = await previewAppImport(files, source);
			target = preview.categoryId ?? 'new';
			step = 'preview';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Upload failed';
			step = 'pick';
		}
	}

	async function start() {
		if (!preview) return;
		error = '';
		try {
			await syncNow(); // push local edits first so duplicate checks see them
			job = await commitAppImport({
				previewId: preview.previewId,
				categoryId: target,
				duplicates: dupMode
			});
			step = 'running';
			poll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Import failed';
		}
	}

	function poll() {
		timer = setTimeout(async () => {
			if (!job) return;
			try {
				job = await getImportJob(job.id);
			} catch (e) {
				error = e instanceof Error ? e.message : 'Lost track of the import';
				step = 'done';
				return;
			}
			if (job.status === 'running') return poll();
			await syncNow();
			step = 'done';
		}, 700);
	}

	function reset() {
		step = 'pick';
		preview = null;
		job = null;
		error = '';
	}
</script>

<div class="stack wizard" data-testid="app-import">
	{#if error}<p class="notice" role="alert" data-testid="import-error">{error}</p>{/if}

	{#if step === 'pick' || step === 'uploading'}
		<FileDrop
			accept={source === 'letterboxd' ? '.zip,.csv,text/csv,application/zip' : '.csv,text/csv'}
			multiple={source !== 'goodreads'}
			disabled={step === 'uploading' || !$syncStatus.online}
			label={step === 'uploading' ? `Reading ${fileNames}…` : `Drop your ${label} export here`}
			hint={source === 'letterboxd'
				? `The ZIP, or any of watchlist.csv, watched.csv, diary.csv, ratings.csv, reviews.csv. Max ${APP_IMPORT_MAX_MB} MB.`
				: source === 'imdb'
					? `ratings.csv and/or list exports (e.g. your watchlist). Max ${APP_IMPORT_MAX_MB} MB.`
					: `goodreads_library_export.csv. Max ${APP_IMPORT_MAX_MB} MB.`}
			testid="import-file"
			onfiles={onFiles}
		/>
		{#if !$syncStatus.online}<p class="xs faint">Importing needs a connection.</p>{/if}
	{:else if step === 'preview' && preview}
		<div class="card pad stack" data-testid="import-preview">
			<div>
				<h3>Found {preview.counts.items} {preview.counts.items === 1 ? 'item' : 'items'}</h3>
				<p class="small muted">
					{preview.counts.logEntries} log {preview.counts.logEntries === 1 ? 'entry' : 'entries'} ·
					{STATUSES.filter((s) => preview!.counts.byStatus[s])
						.map((s) => `${preview!.counts.byStatus[s]} ${STATUS_LABELS[s].toLowerCase()}`)
						.join(' · ')}
				</p>
				<p class="xs faint">From {preview.files.join(', ')}</p>
			</div>
			{#each preview.warnings as w (w)}<p class="notice quiet small">{w}</p>{/each}

			<ul class="samples">
				{#each preview.samples as s, i (i)}
					<li class="small">
						<span class="truncate">{s.title}{s.year ? ` (${s.year})` : ''}</span>
						<span class="faint xs"
							>{STATUS_LABELS[s.status]}{s.logs ? ` · ${s.logs} log` : ''}{s.rating
								? ` · ${stars(s.rating)}`
								: ''}{s.duplicate ? ' · already saved' : ''}</span
						>
					</li>
				{/each}
				{#if preview.counts.items > preview.samples.length}
					<li class="xs faint">…and {preview.counts.items - preview.samples.length} more</li>
				{/if}
			</ul>

			<label class="field">
				<span class="label">Add to list</span>
				<select class="select" bind:value={target} data-testid="import-target">
					{#each store.categories as c (c.id)}<option value={c.id}>{c.icon} {c.name}</option>{/each}
					<option value="new">New list: {preview.newCategoryName}</option>
				</select>
			</label>

			{#if preview.duplicates && target === preview.categoryId}
				<fieldset class="field dups">
					<legend class="label">
						{preview.duplicates} already on {targetCategory?.name ?? 'this list'}
						<span class="faint"
							>({preview.duplicateTitles.slice(0, 3).join(', ')}{preview.duplicates > 3
								? ', …'
								: ''})</span
						>
					</legend>
					<label class="check"
						><input type="radio" bind:group={dupMode} value="skip" /> Skip them</label
					>
					<label class="check"
						><input type="radio" bind:group={dupMode} value="merge" /> Add their log entries to the existing
						items</label
					>
				</fieldset>
			{/if}

			<p class="xs faint">
				{#if preview.matching}
					Titles are matched to TMDB for posters and details. Anything without a confident match is
					saved as a custom item marked “needs match”.
				{:else if source !== 'goodreads'}
					TMDB isn't configured on this server, so everything is saved as custom items marked “needs
					match”.
				{:else}
					Books are saved as custom items with the author and ISBN.
				{/if}
			</p>

			<div class="row wrap">
				<button type="button" class="btn primary" onclick={start} data-testid="import-start"
					>Import {preview.counts.items} {preview.counts.items === 1 ? 'item' : 'items'}</button
				>
				<button type="button" class="btn ghost" onclick={reset}>Choose another file</button>
			</div>
		</div>
	{:else if step === 'running' && job}
		<div class="card pad stack" aria-live="polite">
			<h3>Importing…</h3>
			<div
				class="bar"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={job.total}
				aria-valuenow={job.done}
				aria-label="Import progress"
			>
				<span style:transform="scaleX({pct / 100})"></span>
			</div>
			<p class="small muted num">
				{job.done} of {job.total}{job.matched
					? ` · ${job.matched} matched`
					: ''}{job.skippedDuplicates ? ` · ${job.skippedDuplicates} skipped` : ''}
			</p>
			<p class="xs faint">You can leave this page; the import keeps running.</p>
		</div>
	{:else if step === 'done' && job}
		<div class="card pad stack" data-testid="import-done">
			<h3>{job.status === 'error' ? 'Import stopped' : 'Import finished'}</h3>
			{#if job.error}<p class="notice small">{job.error}</p>{/if}
			<ul class="summary small">
				<li data-testid="import-created">
					{job.created} new {job.created === 1 ? 'item' : 'items'}
				</li>
				{#if job.matched}<li>{job.matched} matched to TMDB</li>{/if}
				{#if job.merged}<li>
						{job.merged} existing {job.merged === 1 ? 'item' : 'items'} updated
					</li>{/if}
				{#if job.logEntries}<li>
						{job.logEntries} log {job.logEntries === 1 ? 'entry' : 'entries'}
					</li>{/if}
				{#if job.skippedDuplicates}<li>
						{job.skippedDuplicates}
						{job.skippedDuplicates === 1 ? 'duplicate' : 'duplicates'} skipped
					</li>{/if}
			</ul>
			<div class="row wrap">
				<a class="btn primary" href="/c/{job.categoryId}" data-testid="import-open-list"
					>Open {doneCategory ? `${doneCategory.icon} ${doneCategory.name}` : 'the list'}</a
				>
				{#if job.unmatched}
					<a class="btn" href="/c/{job.categoryId}?status=all&match=1" data-testid="import-review"
						>Review {job.unmatched} unmatched {job.unmatched === 1 ? 'item' : 'items'}</a
					>
				{/if}
				<button type="button" class="btn ghost" onclick={reset}>Import another file</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.wizard h3 {
		font-family: var(--font-serif);
		font-size: var(--fs-lg);
		font-weight: 560;
		letter-spacing: -0.01em;
	}
	.samples,
	.summary {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
	}
	.samples {
		gap: 0;
	}
	.samples li {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--s-3);
		min-width: 0;
		padding: var(--s-2) 0;
		border-top: 1px solid var(--border);
	}
	.samples li:first-child {
		border-top: none;
	}
	.samples li > span:first-child {
		font-family: var(--font-serif);
		font-size: var(--fs);
		font-weight: 560;
	}
	.summary li {
		font-variant-numeric: tabular-nums;
	}
	.dups {
		border: none;
		margin: 0;
		padding: 0;
		gap: var(--s-1);
	}
	.bar {
		height: 8px;
		border-radius: var(--r-pill);
		background: var(--surface-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
		transform-origin: left center;
		transition: transform var(--dur-3) var(--ease-out);
	}
</style>
