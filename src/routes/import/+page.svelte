<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import AppImportWizard from '#lib/components/import/AppImportWizard.svelte';
	import { APP_NAME } from '#lib/shared/config.ts';
	import type { AppImportSource } from '#lib/shared/types.ts';

	type Choice = AppImportSource | 'json';
	const CHOICES: { id: Choice; label: string }[] = [
		{ id: 'letterboxd', label: 'Letterboxd' },
		{ id: 'imdb', label: 'IMDb' },
		{ id: 'goodreads', label: 'Goodreads' },
		{ id: 'json', label: `${APP_NAME} JSON` }
	];
	const fromUrl = page.url.searchParams.get('source');
	let choice = $state<Choice>(CHOICES.find((c) => c.id === fromUrl)?.id ?? 'letterboxd');

	function pick(c: Choice) {
		choice = c;
		void goto(`/import?source=${c}`, { replace: true, reset: false });
	}
</script>

<svelte:head><title>Import · {APP_NAME}</title></svelte:head>

<div class="stack page">
	<div>
		<h1>Import</h1>
		<p class="muted small">
			Bring in what you've already tracked elsewhere. Films are matched to TMDB where possible;
			everything else becomes a custom item with its log entries.
		</p>
	</div>

	<div class="row wrap" role="group" aria-label="Import from">
		{#each CHOICES as c (c.id)}
			<button
				type="button"
				class="chip"
				aria-pressed={choice === c.id}
				data-testid="import-source-{c.id}"
				onclick={() => pick(c.id)}>{c.label}</button
			>
		{/each}
	</div>

	<section class="card pad stack" aria-labelledby="howto-h">
		<h2 id="howto-h" class="section-title">How to export</h2>
		{#if choice === 'letterboxd'}
			<p class="small">
				On letterboxd.com go to <strong>Settings → Import &amp; Export → Export your data</strong>.
				You get a ZIP; upload it as is. Your watchlist becomes <em>Want</em>, watched films become
				<em>Done</em>, and each diary entry becomes a log entry with its date, rating, rewatch flag,
				tags and review.
			</p>
		{:else if choice === 'imdb'}
			<p class="small">
				On imdb.com open <strong>Your ratings</strong> or <strong>Your watchlist</strong> (or any
				list), then use <strong>Export</strong> from the ⋯ menu. Upload the CSVs (several at once is
				fine). Rated titles become <em>Done</em> with a log entry; list entries become
				<em>Want</em>.
			</p>
		{:else if choice === 'goodreads'}
			<p class="small">
				On goodreads.com go to <strong>My Books → Import and export → Export Library</strong> and
				download <code>goodreads_library_export.csv</code>. Shelves map to statuses (to-read → Want,
				currently-reading → In progress, read → Done); ratings, read dates and reviews become log
				entries.
			</p>
		{:else}
			<p class="small">
				Restore or move a full {APP_NAME} export (made from Settings → Your data → Export everything).
				That import lives in Settings because it can also replace all your data.
			</p>
			<p><a class="btn" href="/settings#data">Go to Settings → Your data</a></p>
		{/if}
	</section>

	{#if choice !== 'json'}
		{#key choice}
			<AppImportWizard source={choice} />
		{/key}
	{/if}
</div>

<style>
	.page {
		max-width: 720px;
	}
</style>
