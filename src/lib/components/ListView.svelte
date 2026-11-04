<script lang="ts">
	// Item list for one category (categoryId) or all categories (null). Filters live in the URL.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import ItemCard from './ItemCard.svelte';
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
			(filters.sort !== 'added' ? 1 : 0)
	);
	let showMore = $state(untrack(() => activeAdvanced > 0));
	let pickOpen = $state(false);
	const isFiltered = $derived(!isDefaultFilters({ ...filters, q: qInput }));
	const title = $derived(category ? category.name : 'All');
</script>

<svelte:head><title>{title} · Forgetless</title></svelte:head>

{#if categoryId && store.ready && !category}
	<div class="empty">
		<div class="big" aria-hidden="true">🤷</div>
		<h2>This list doesn't exist</h2>
		<p class="muted">It may have been deleted on another device.</p>
		<a class="btn" href="/">Back to All</a>
	</div>
{:else}
	<div class="head">
		<h1>
			{#if category}<span class="hicon" aria-hidden="true">{category.icon}</span>{/if}{title}
		</h1>
		<span class="count muted small">{rows.length} {rows.length === 1 ? 'item' : 'items'}</span>
		<div class="grow"></div>
		<button
			type="button"
			class="btn"
			onclick={() => (pickOpen = true)}
			disabled={!rows.length}
			data-testid="pick-for-me"
		>
			<span aria-hidden="true">🎲</span> Pick for me
		</button>
	</div>

	<div class="toolbar">
		<div class="searchbox">
			<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
				><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" stroke-width="1.5" /><path
					d="M10.5 10.5L14 14"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/></svg
			>
			<input
				class="input"
				type="search"
				placeholder="Search title, people, notes, tags…"
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
			Filters{#if activeAdvanced}<span class="badge">{activeAdvanced}</span>{/if}
		</button>
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
				Has rating
			</label>
		</div>
	{/if}

	{#if !store.ready || (!store.categories.length && $syncStatus.syncing)}
		<div class="list skeleton" aria-busy="true" aria-label="Loading">
			{#each [1, 2, 3, 4] as i (i)}<div class="sk"></div>{/each}
		</div>
	{:else if rows.length}
		<div class="list card">
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
	{:else if scope.length && isFiltered}
		<div class="empty">
			<div class="big" aria-hidden="true">🔍</div>
			<h2>No matches</h2>
			<p class="muted">Nothing fits these filters{qInput ? ` and “${qInput}”` : ''}.</p>
			<div class="row">
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
			<div class="big" aria-hidden="true">{category?.icon ?? '✨'}</div>
			<h2>Nothing here yet</h2>
			<p class="muted">
				Press <kbd>n</kbd> (or tap <strong>+</strong>) to capture something{category
					? ` for ${category.name}`
					: ''} — a show a friend mentioned, a place you walked past, a book from a podcast.
			</p>
			<button type="button" class="btn primary" onclick={() => openCapture(categoryId)}
				>Capture something</button
			>
		</div>
	{/if}

	<PickModal open={pickOpen} items={rows} onclose={() => (pickOpen = false)} />
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--s-2) var(--s-3);
		margin-bottom: var(--s-4);
	}
	.hicon {
		margin-right: var(--s-2);
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
	.searchbox svg {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-3);
		pointer-events: none;
	}
	.searchbox .input {
		padding-left: 36px;
	}
	.toolbar .btn {
		min-height: 40px;
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
		padding: var(--s-3);
		margin-bottom: var(--s-4);
		border-radius: var(--r-lg);
		background: var(--surface-2);
	}
	@media (min-width: 720px) {
		.more {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.rated {
		min-height: 32px;
	}
	.list {
		display: flex;
		flex-direction: column;
		padding: var(--s-1);
	}
	.list.card > :global(a + a)::before {
		content: '';
		position: absolute;
		top: 0;
		left: 68px;
		right: var(--s-3);
		height: 1px;
		background: var(--border);
	}
	.list.card > :global(a:hover::before),
	.list.card > :global(a:hover + a::before) {
		opacity: 0;
	}
	.skeleton {
		gap: var(--s-2);
	}
	.sk {
		height: 72px;
		border-radius: var(--r-lg);
		background: linear-gradient(90deg, var(--surface-2), var(--surface-hover), var(--surface-2));
		background-size: 200% 100%;
		animation: shimmer 1.2s linear infinite;
	}
	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--s-3);
		padding: var(--s-7) var(--s-4);
		border: 1px dashed var(--border-strong);
		border-radius: var(--r-xl);
	}
	.empty p {
		max-width: 420px;
	}
	.big {
		font-size: 40px;
		line-height: 1;
	}
</style>
