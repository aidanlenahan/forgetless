<script lang="ts">
	// Item list for one category (categoryId) or all categories (null). Filters live in the URL.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import ItemCard from './ItemCard.svelte';
	import Icon from './Icon.svelte';
	import PickModal from './PickModal.svelte';
	import { store } from '#lib/client/store.svelte.ts';
	import { openCapture } from '#lib/client/ui.svelte.ts';
	import { syncStatus } from '#lib/client/sync.ts';
	import {
		parseFilters,
		serializeFilters,
		filterItems,
		sortItems,
		distinctValues,
		latestRating,
		isDefaultFilters,
		SORT_LABELS,
		DEFAULT_STATUSES,
		type ListFilters,
		type SortKey
	} from '#lib/client/queries.ts';
	import { STATUSES, STATUS_LABELS, type Status } from '#lib/shared/types.ts';

	let { categoryId = null }: { categoryId?: string | null } = $props();

	const category = $derived(categoryId ? store.categoryById.get(categoryId) : undefined);
	const filters = $derived(parseFilters(page.url.searchParams));

	// Search box: instant local filtering, URL updated (debounced) for persistence.
	let qInput = $state(untrack(() => filters.q));
	let lastUrlQ = untrack(() => filters.q);
	$effect(() => {
		const urlQ = filters.q;
		if (urlQ !== lastUrlQ) {
			lastUrlQ = urlQ;
			qInput = urlQ;
		}
	});
	$effect(() => {
		const v = qInput;
		if (v.trim() === untrack(() => filters.q)) return;
		const t = setTimeout(() => {
			lastUrlQ = v.trim();
			update({ q: v });
		}, 300);
		return () => clearTimeout(t);
	});

	function update(p: Partial<ListFilters>) {
		const next = { ...filters, q: qInput, ...p };
		const qs = serializeFilters(next);
		void goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, { replace: true, reset: false });
	}
	function toggleStatus(s: Status) {
		const has = filters.status.includes(s);
		const next = has ? filters.status.filter((x) => x !== s) : [...filters.status, s];
		update({ status: next.length ? STATUSES.filter((x) => next.includes(x)) : DEFAULT_STATUSES });
	}
	function reset() {
		qInput = '';
		lastUrlQ = '';
		void goto(page.url.pathname, { replace: true, reset: false });
	}

	const scope = $derived(
		categoryId ? store.items.filter((i) => i.categoryId === categoryId) : store.items
	);
	const tags = $derived(distinctValues(scope.flatMap((i) => i.tags)));
	const people = $derived(distinctValues(scope.map((i) => i.recommendedBy)));
	const filtered = $derived(filterItems(scope, filters, store.logsByItem, qInput));
	const rows = $derived(sortItems(filtered, filters.sort, store.logsByItem));
	const activeAdvanced = $derived(
		(filters.tag ? 1 : 0) +
			(filters.by ? 1 : 0) +
			(filters.rated ? 1 : 0) +
			(filters.match ? 1 : 0) +
			(filters.sort !== 'added' ? 1 : 0)
	);
	let showMore = $state(untrack(() => activeAdvanced > 0));
	let pickOpen = $state(false);
	const isFiltered = $derived(!isDefaultFilters({ ...filters, q: qInput }));
	const title = $derived(category ? category.name : 'All');

	// Presentation only: list rows or a poster grid, remembered per list on this device.
	const viewKey = $derived(`app:view:${categoryId ?? 'all'}`);
	let view = $state<'list' | 'grid'>('list');
	$effect(() => {
		try {
			view = localStorage.getItem(viewKey) === 'grid' ? 'grid' : 'list';
		} catch {
			view = 'list';
		}
	});
	function setView(v: 'list' | 'grid') {
		view = v;
		try {
			localStorage.setItem(viewKey, v);
		} catch {
			/* ignore */
		}
	}
	// Places (OSM) have no artwork, so a poster grid only makes sense when some entry has an image.
	const hasPosters = $derived(
		category?.provider === 'tmdb' ||
			scope.some((i) => i.catalogEntryId && store.catalog.get(i.catalogEntryId)?.imageUrl)
	);
</script>

<svelte:head><title>{title} · Forgetless</title></svelte:head>

{#if categoryId && store.ready && !category}
	<div class="empty">
		<h2>This list doesn't exist</h2>
		<p class="muted">You may have deleted it on another device.</p>
		<a class="btn" href="/">Back to All</a>
	</div>
{:else}
	<header class="head">
		<div class="titles">
			<h1>
				{#if category}<span class="hicon" aria-hidden="true">{category.icon}</span>{/if}{title}
			</h1>
			<span class="count num">{rows.length} {rows.length === 1 ? 'item' : 'items'}</span>
		</div>
		<button
			type="button"
			class="btn pick"
			onclick={() => (pickOpen = true)}
			disabled={!rows.length}
			data-testid="pick-for-me"
		>
			<Icon name="dice" size={18} /> Pick for me
		</button>
	</header>

	<div class="toolbar">
		<div class="searchbox">
			<Icon name="search" size={17} />
			<input
				class="input"
				type="search"
				placeholder="Search your lists"
				aria-label="Search items"
				bind:value={qInput}
				data-testid="list-search"
			/>
		</div>
		<button
			type="button"
			class="btn"
			aria-expanded={showMore}
			aria-controls="more-filters"
			onclick={() => (showMore = !showMore)}
		>
			<Icon name="filter" size={17} /><span class="hide-xs">Filters</span>{#if activeAdvanced}<span
					class="badge num">{activeAdvanced}</span
				>{/if}
		</button>
		{#if hasPosters}
			<div class="seg" role="group" aria-label="Layout">
				<button
					type="button"
					class="segbtn"
					aria-pressed={view === 'list'}
					aria-label="List"
					title="List"
					onclick={() => setView('list')}><Icon name="list" size={17} /></button
				>
				<button
					type="button"
					class="segbtn"
					aria-pressed={view === 'grid'}
					aria-label="Posters"
					title="Posters"
					onclick={() => setView('grid')}><Icon name="grid" size={17} /></button
				>
			</div>
		{/if}
	</div>

	<div class="statuses" role="group" aria-label="Status filter">
		{#each STATUSES as s (s)}
			<button
				type="button"
				class="chip"
				aria-pressed={filters.status.includes(s)}
				onclick={() => toggleStatus(s)}
				data-testid="status-filter-{s}"
			>
				{STATUS_LABELS[s]}
			</button>
		{/each}
		{#if isFiltered}<button type="button" class="btn ghost sm" onclick={reset}>Reset</button>{/if}
	</div>

	{#if showMore}
		<div id="more-filters" class="more">
			<label class="field">
				<span class="label">Sort by</span>
				<select
					class="select sm"
					value={filters.sort}
					onchange={(e) => update({ sort: e.currentTarget.value as SortKey })}
					data-testid="sort-select"
				>
					{#each Object.entries(SORT_LABELS) as [k, l] (k)}<option value={k}>{l}</option>{/each}
				</select>
			</label>
			<label class="field">
				<span class="label">Tag</span>
				<select
					class="select sm"
					value={filters.tag ?? ''}
					onchange={(e) => update({ tag: e.currentTarget.value || null })}
				>
					<option value="">Any tag</option>
					{#each tags as t (t)}<option value={t}>#{t}</option>{/each}
					{#if filters.tag && !tags.includes(filters.tag)}<option value={filters.tag}
							>#{filters.tag}</option
						>{/if}
				</select>
			</label>
			<label class="field">
				<span class="label">Recommended by</span>
				<select
					class="select sm"
					value={filters.by ?? ''}
					onchange={(e) => update({ by: e.currentTarget.value || null })}
				>
					<option value="">Anyone</option>
					{#each people as p (p)}<option value={p}>{p}</option>{/each}
					{#if filters.by && !people.some((p) => p.toLowerCase() === filters.by?.toLowerCase())}<option
							value={filters.by}>{filters.by}</option
						>{/if}
				</select>
			</label>
			<label class="check rated">
				<input
					type="checkbox"
					checked={filters.rated}
					onchange={(e) => update({ rated: e.currentTarget.checked })}
				/>
				Has a rating
			</label>
			<label class="check rated">
				<input
					type="checkbox"
					checked={filters.match}
					onchange={(e) => update({ match: e.currentTarget.checked })}
					data-testid="filter-needs-match"
				/>
				Needs a match
			</label>
		</div>
	{/if}

	{#if !store.ready || (!store.categories.length && $syncStatus.syncing)}
		<div class="list skeleton" aria-busy="true" aria-label="Loading">
			{#each [1, 2, 3, 4, 5] as i (i)}
				<div class="sk">
					<span class="skp"></span>
					<span class="skl"><span></span><span></span></span>
				</div>
			{/each}
		</div>
	{:else if rows.length}
		{#if view === 'grid' && hasPosters}
			<div class="grid">
				{#each rows as item (item.id)}
					{@const logs = store.logsByItem.get(item.id)}
					<ItemCard
						{item}
						variant="tile"
						category={store.categoryById.get(item.categoryId)}
						entry={item.catalogEntryId ? store.catalog.get(item.catalogEntryId) : undefined}
						rating={latestRating(logs)}
					/>
				{/each}
			</div>
		{:else}
			<div class="list">
				{#each rows as item (item.id)}
					{@const logs = store.logsByItem.get(item.id)}
					<ItemCard
						{item}
						category={store.categoryById.get(item.categoryId)}
						entry={item.catalogEntryId ? store.catalog.get(item.catalogEntryId) : undefined}
						rating={latestRating(logs)}
						showCategory={!categoryId}
					/>
				{/each}
			</div>
		{/if}
	{:else if scope.length && isFiltered}
		<div class="empty">
			<h2>No matches</h2>
			<p class="muted">
				Nothing on this list fits these filters{qInput ? ` or “${qInput}”` : ''}.
			</p>
			<div class="row wrap center">
				<button type="button" class="btn" onclick={reset}>Clear filters</button>
				{#if qInput.trim()}<button
						type="button"
						class="btn primary"
						onclick={() => openCapture(categoryId, qInput.trim())}>Add “{qInput.trim()}”</button
					>{/if}
			</div>
		</div>
	{:else}
		<div class="empty">
			{#if category}<div class="big" aria-hidden="true">{category.icon}</div>{/if}
			<h2>{category ? `Your ${category.name} list is empty` : 'Nothing saved yet'}</h2>
			<p class="muted">
				Next time someone mentions a show, a book or a place, press <kbd>N</kbd> or tap
				<strong>+</strong> and type the name. Add who told you if you like.
			</p>
			<button type="button" class="btn primary" onclick={() => openCapture(categoryId)}
				><Icon name="plus" size={18} /> Capture something</button
			>
			<p class="muted small">
				Or <a href="/import" data-testid="empty-import-link"
					>import from Letterboxd, IMDb or Goodreads</a
				>.
			</p>
		</div>
	{/if}

	<PickModal open={pickOpen} items={rows} onclose={() => (pickOpen = false)} />
{/if}

<style>
	.head {
		display: flex;
		align-items: flex-end;
		gap: var(--s-3);
		margin-bottom: var(--s-5);
	}
	.titles {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 2px var(--s-3);
	}
	h1 {
		font-size: var(--fs-xl);
		overflow-wrap: anywhere;
	}
	@media (min-width: 900px) {
		h1 {
			font-size: 2.25rem;
		}
	}
	.hicon {
		margin-right: 0.3em;
		font-size: 0.8em;
		font-style: normal;
	}
	.count {
		font-size: var(--fs-sm);
		color: var(--text-2);
	}
	.pick {
		flex: none;
	}
	.toolbar {
		display: flex;
		gap: var(--s-2);
		margin-bottom: var(--s-3);
	}
	.searchbox {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.searchbox :global(.icon) {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-3);
		pointer-events: none;
	}
	.searchbox .input {
		padding-left: 38px;
		background: var(--surface);
	}
	.toolbar .btn {
		min-height: 44px;
	}
	@media (min-width: 720px) {
		.toolbar .btn {
			min-height: 40px;
		}
	}
	@media (max-width: 420px) {
		/* Visually hidden on narrow screens; it still names the button for screen readers. */
		.hide-xs {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
		.toolbar > .btn {
			padding: 0 var(--s-3);
		}
	}
	.badge {
		display: inline-grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: var(--r-pill);
		background: var(--accent);
		color: var(--on-accent);
		font-size: 11px;
	}
	.seg {
		display: flex;
		flex: none;
		padding: 3px;
		gap: 2px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r);
		background: var(--surface);
	}
	.segbtn {
		display: grid;
		place-items: center;
		width: 36px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
		transition:
			background-color var(--dur-1) ease,
			color var(--dur-1) ease;
	}
	.segbtn[aria-pressed='true'] {
		background: var(--surface-2);
		color: var(--text);
	}
	@media (pointer: coarse) {
		.segbtn {
			width: 40px;
		}
	}
	.statuses {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2);
		margin-bottom: var(--s-4);
	}
	.more {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--s-3);
		align-items: end;
		padding: var(--s-4);
		margin-bottom: var(--s-4);
		border-radius: var(--r-lg);
		background: var(--surface-2);
		animation: rise-in var(--dur-2) var(--ease-out);
	}
	@media (min-width: 720px) {
		.more {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.rated {
		min-height: 36px;
	}
	.list {
		display: flex;
		flex-direction: column;
		margin: 0 calc(-1 * var(--s-3));
	}
	.list > :global(a + a)::before {
		content: '';
		position: absolute;
		top: 0;
		left: calc(48px + var(--s-3) + var(--s-4));
		right: var(--s-3);
		height: 1px;
		background: var(--border);
	}
	@media (hover: hover) {
		.list > :global(a:hover::before),
		.list > :global(a:hover + a::before) {
			opacity: 0;
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: var(--s-5) var(--s-3);
	}
	@media (min-width: 720px) {
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		}
	}
	.skeleton {
		margin: 0;
	}
	.sk {
		display: flex;
		align-items: center;
		gap: var(--s-4);
		padding: var(--s-3) 0;
	}
	.skp {
		width: 48px;
		height: 72px;
		border-radius: var(--r-xs);
		background: var(--surface-2);
	}
	.skl {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.skl span {
		height: 14px;
		width: 55%;
		border-radius: 3px;
		background: var(--surface-2);
	}
	.skl span + span {
		width: 30%;
		height: 11px;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--s-3);
		padding: var(--s-7) var(--s-4);
		border: 1px dashed var(--border-strong);
		border-radius: var(--r-lg);
	}
	.empty p {
		max-width: 44ch;
	}
	.center {
		justify-content: center;
	}
	.big {
		font-size: 36px;
		line-height: 1;
	}
</style>
