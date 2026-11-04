<script lang="ts">
	// Quick capture: one input -> (1) your matching items, (2) your catalog rows, (3) provider hits,
	// (4) add as custom.
	// Then an optional context sheet with a one-tap Save.
	import { goto } from '$app/navigation';
	import Poster from './Poster.svelte';
	import Icon from './Icon.svelte';
	import { capture, toast } from '#lib/client/ui.svelte.ts';
	import { store } from '#lib/client/store.svelte.ts';
	import { session } from '#lib/client/session.svelte.ts';
	import { syncStatus } from '#lib/client/sync.ts';
	import { saveItem } from '#lib/client/mutations.ts';
	import { searchProvider, selectProviderHit, kindLabel } from '#lib/client/provider.ts';
	import { titleMatches, distinctValues, parseTags, normalize } from '#lib/client/queries.ts';
	import { timeAgo } from '#lib/client/format.ts';
	import {
		hasCatalogs,
		refreshCatalogs,
		searchCatalogs,
		catalogFields
	} from '#lib/client/catalogs.svelte.ts';
	import { localDb } from '#lib/client/db.ts';
	import {
		STATUSES,
		STATUS_LABELS,
		type CatalogEntry,
		type CatalogHit,
		type Item,
		type Status
	} from '#lib/shared/types.ts';

	const LAST_CAT = 'app:lastCaptureCategory';
	const hitCache = new Map<string, CatalogHit[]>();

	function initialCategory(): string | null {
		const cats = store.categories;
		if (capture.categoryId && store.categoryById.has(capture.categoryId)) return capture.categoryId;
		try {
			const last = localStorage.getItem(LAST_CAT);
			if (last && store.categoryById.has(last)) return last;
		} catch {
			/* ignore */
		}
		return cats[0]?.id ?? null;
	}

	let query = $state(capture.text);
	let categoryId = $state<string | null>(initialCategory());
	let step = $state<'search' | 'context'>('search');
	let active = $state(-1);
	let hits = $state<CatalogHit[]>([]);
	let pstate = $state<'idle' | 'loading' | 'done' | 'error' | 'offline'>('idle');
	let perror = $state('');
	let selecting = $state<string | null>(null);
	let saving = $state(false);
	let input = $state<HTMLInputElement>();
	let saveBtn = $state<HTMLButtonElement>();
	$effect(() => {
		if (step === 'context' && saveBtn) saveBtn.focus();
	});

	interface Draft {
		title: string;
		catalogEntryId: string | null;
		needsMatch: boolean;
		imageUrl: string | null;
		sub: string;
		customFields?: Record<string, unknown>;
	}
	let draft = $state<Draft | null>(null);
	let recommendedBy = $state('');
	let source = $state('');
	let why = $state('');
	let tagsText = $state('');
	let status = $state<Status>('want');

	const category = $derived(categoryId ? store.categoryById.get(categoryId) : undefined);
	const online = $derived($syncStatus.online);
	const providerOn = $derived(category?.provider === 'tmdb' && session.config.providers.tmdb);
	const q = $derived(query.trim());
	const own = $derived(titleMatches(store.items, q, 5));

	// User catalogs attached to this category (server search; needs a connection).
	void refreshCatalogs();
	const catalogOn = $derived(online && hasCatalogs(categoryId));
	let catHits = $state<CatalogEntry[]>([]);

	type Opt =
		| { type: 'own'; item: Item }
		| { type: 'catalog'; entry: CatalogEntry }
		| { type: 'hit'; hit: CatalogHit }
		| { type: 'custom' };
	const options = $derived<Opt[]>([
		...own.map((item) => ({ type: 'own' as const, item })),
		...(catalogOn ? catHits.map((entry) => ({ type: 'catalog' as const, entry })) : []),
		...(providerOn && online ? hits.map((hit) => ({ type: 'hit' as const, hit })) : []),
		...(q ? [{ type: 'custom' as const }] : [])
	]);
	const ownCount = $derived(own.length);
	const catCount = $derived(catalogOn ? catHits.length : 0);
	const hitCount = $derived(providerOn && online ? hits.length : 0);

	$effect(() => {
		const text = q;
		const cid = categoryId;
		if (!catalogOn || !cid || !text) {
			catHits = [];
			return;
		}
		const ctrl = new AbortController();
		const t = setTimeout(async () => {
			try {
				catHits = (await searchCatalogs(cid, text, ctrl.signal)).slice(0, 8);
			} catch {
				if (!ctrl.signal.aborted) catHits = [];
			}
		}, 150);
		return () => {
			clearTimeout(t);
			ctrl.abort();
		};
	});

	$effect(() => {
		void q;
		active = -1;
	});

	// Provider search, debounced.
	$effect(() => {
		const text = q;
		if (!providerOn || text.length < 2) {
			hits = [];
			pstate = 'idle';
			return;
		}
		if (!online) {
			pstate = 'offline';
			return;
		}
		const key = `${text.toLowerCase()}`;
		const cached = hitCache.get(key);
		if (cached) {
			hits = cached;
			pstate = 'done';
			return;
		}
		pstate = 'loading';
		const ctrl = new AbortController();
		const t = setTimeout(async () => {
			try {
				const h = (await searchProvider('tmdb', text, ctrl.signal)).slice(0, 8);
				hitCache.set(key, h);
				hits = h;
				pstate = 'done';
			} catch (e) {
				if (ctrl.signal.aborted) return;
				hits = [];
				pstate = navigator.onLine ? 'error' : 'offline';
				perror = e instanceof Error ? e.message : 'Search failed';
			}
		}, 200);
		return () => {
			clearTimeout(t);
			ctrl.abort();
		};
	});

	const recommenders = $derived(distinctValues(store.items.map((i) => i.recommendedBy)));
	const allTags = $derived(distinctValues(store.items.flatMap((i) => i.tags)));
	const tagSuggestions = $derived.by(() => {
		const parts = tagsText.split(',');
		const cur = normalize(parts[parts.length - 1].trim());
		const have = new Set(parseTags(tagsText));
		return allTags.filter((t) => !have.has(t) && (!cur || t.includes(cur))).slice(0, 8);
	});
	const duplicate = $derived(
		draft
			? store.items.find(
					(i) => i.categoryId === categoryId && normalize(i.title) === normalize(draft!.title)
				)
			: undefined
	);

	function pickCategory(id: string) {
		categoryId = id;
		input?.focus();
	}

	function customDraft(title: string): Draft {
		// Offline (or provider down) in a provider category: save as custom and flag it for matching later.
		const needsMatch = !!providerOn && (!online || pstate === 'error' || pstate === 'offline');
		return {
			title,
			catalogEntryId: null,
			needsMatch,
			imageUrl: null,
			sub: needsMatch ? 'Custom · will match later' : 'Custom item'
		};
	}

	async function draftFromHit(hit: CatalogHit): Promise<Draft> {
		selecting = hit.externalId;
		try {
			const entry = await selectProviderHit('tmdb', hit);
			return {
				title: entry.title,
				catalogEntryId: entry.id,
				needsMatch: false,
				imageUrl: entry.imageUrl,
				sub: [entry.year, kindLabel(entry.kind)].filter(Boolean).join(' · ')
			};
		} catch {
			toast("Couldn't load details. Saving as custom; you can link the match later.", {
				kind: 'error'
			});
			return {
				title: hit.title,
				catalogEntryId: null,
				needsMatch: true,
				imageUrl: hit.imageUrl,
				sub: 'Custom · will match later'
			};
		} finally {
			selecting = null;
		}
	}

	async function draftFromCatalog(entry: CatalogEntry): Promise<Draft> {
		// Keep the row locally so the item shows its metadata before the next sync.
		await localDb().catalogEntries.put($state.snapshot(entry));
		return {
			title: entry.title,
			catalogEntryId: entry.id,
			needsMatch: false,
			imageUrl: entry.imageUrl,
			sub: [entry.year, entry.subtitle].filter(Boolean).join(' · ') || 'From your catalog',
			customFields: catalogFields(entry)
		};
	}

	function openExisting(item: Item) {
		capture.open = false;
		void goto(`/i/${item.id}`);
	}

	async function choose(opt: Opt | undefined, quick = false) {
		if (!categoryId) return;
		if (!opt) {
			if (!q) return;
			opt = { type: 'custom' };
		}
		if (opt.type === 'own') return openExisting(opt.item);
		if (selecting) return;
		draft =
			opt.type === 'hit'
				? await draftFromHit(opt.hit)
				: opt.type === 'catalog'
					? await draftFromCatalog(opt.entry)
					: customDraft(q);
		if (quick) await save();
		else step = 'context';
	}

	async function save() {
		if (!draft || !categoryId || saving) return;
		saving = true;
		try {
			const item = await saveItem({
				title: draft.title,
				categoryId,
				catalogEntryId: draft.catalogEntryId,
				needsMatch: draft.needsMatch,
				customFields: $state.snapshot(draft.customFields) ?? {},
				recommendedBy: recommendedBy.trim() || null,
				source: source.trim() || null,
				why: why.trim() || null,
				tags: parseTags(tagsText),
				status
			});
			try {
				localStorage.setItem(LAST_CAT, categoryId);
			} catch {
				/* ignore */
			}
			capture.open = false;
			const c = store.categoryById.get(categoryId);
			toast(`Saved to ${c ? `${c.icon} ${c.name}` : 'your list'}`, {
				kind: 'success',
				action: { label: 'View', href: `/i/${item.id}` }
			});
		} catch (e) {
			toast(`Couldn't save: ${e instanceof Error ? e.message : e}`, { kind: 'error' });
		} finally {
			saving = false;
		}
	}

	function onInputKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = options.length ? (active + 1) % options.length : -1;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = options.length ? (active <= 0 ? options.length - 1 : active - 1) : -1;
		} else if (e.key === 'Enter' && !e.isComposing) {
			e.preventDefault();
			void choose(active >= 0 ? options[active] : undefined, e.metaKey || e.ctrlKey);
		}
	}

	$effect(() => {
		if (active < 0) return;
		document.getElementById(`cap-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
	});

	function addTag(t: string) {
		const parts = parseTags(tagsText.split(',').slice(0, -1).join(','));
		tagsText = [...parts, t].join(', ') + ', ';
	}

	function back() {
		step = 'search';
		draft = null;
		queueMicrotask(() => input?.focus());
	}

	function ownMeta(i: Item) {
		const c = store.categoryById.get(i.categoryId);
		return [
			c ? `On ${c.icon} ${c.name}` : null,
			`added ${timeAgo(i.createdAt)}`,
			i.recommendedBy ? `from ${i.recommendedBy}` : null,
			i.status !== 'want' ? STATUS_LABELS[i.status] : null
		]
			.filter(Boolean)
			.join(' · ');
	}
	const optId = (i: number) => `cap-opt-${i}`;
</script>

{#if !store.categories.length}
	<div class="empty">
		<p>You need a category first.</p>
		<a class="btn primary" href="/settings" onclick={() => (capture.open = false)}
			>Create a category</a
		>
	</div>
{:else if step === 'search'}
	<div class="search">
		<div class="inputrow">
			<span class="cap-icon" aria-hidden="true"
				>{#if category}{category.icon}{:else}<Icon name="plus" size={20} />{/if}</span
			>
			<input
				bind:this={input}
				bind:value={query}
				class="capture-input"
				data-autofocus
				data-testid="capture-input"
				type="text"
				placeholder={category ? `Add to ${category.name}` : 'What do you want to remember?'}
				autocomplete="off"
				autocapitalize="sentences"
				enterkeyhint="go"
				role="combobox"
				aria-label="Title"
				aria-expanded={options.length > 0}
				aria-controls="capture-results"
				aria-autocomplete="list"
				aria-activedescendant={active >= 0 ? optId(active) : undefined}
				onkeydown={onInputKey}
			/>
			<button
				type="button"
				class="btn primary"
				disabled={!q || !!selecting}
				data-testid="capture-quick-save"
				title="Save without details (Ctrl/⌘+Enter)"
				onclick={() => void choose(active >= 0 ? options[active] : undefined, true)}>Save</button
			>
		</div>

		<div class="chips" role="group" aria-label="Category">
			{#each store.categories as c (c.id)}
				<button
					type="button"
					class="chip"
					aria-pressed={c.id === categoryId}
					onclick={() => pickCategory(c.id)}
				>
					<span aria-hidden="true">{c.icon}</span>{c.name}
				</button>
			{/each}
		</div>

		{#if q}
			<div id="capture-results" class="results" role="listbox" aria-label="Results">
				{#if ownCount}
					<div class="group dupgroup" role="presentation">
						<Icon name="alert" size={14} /> Already saved
					</div>
					{#each own as item, i (item.id)}
						{@const entry = item.catalogEntryId
							? store.catalog.get(item.catalogEntryId)
							: undefined}
						<div
							id={optId(i)}
							class="opt own"
							class:active={active === i}
							role="option"
							tabindex="-1"
							aria-selected={active === i}
							data-testid="capture-result-own"
							onclick={() => void choose({ type: 'own', item })}
							onkeydown={() => {}}
							onpointerenter={() => (active = i)}
						>
							<Poster
								src={entry?.imageUrl}
								icon={store.categoryById.get(item.categoryId)?.icon}
								title={item.title}
								width={32}
							/>
							<span class="grow">
								<span class="t truncate">{item.title}</span>
								<span class="m warn">{ownMeta(item)}</span>
							</span>
							<span class="go small">Open</span>
						</div>
					{/each}
				{/if}

				{#if catalogOn && catHits.length}
					<div class="group" role="presentation">From your catalogs</div>
					{#each catHits as entry, j (entry.id)}
						{@const i = ownCount + j}
						<div
							id={optId(i)}
							class="opt"
							class:active={active === i}
							role="option"
							tabindex="-1"
							aria-selected={active === i}
							data-testid="capture-result-catalog"
							onclick={() => void choose({ type: 'catalog', entry })}
							onkeydown={() => {}}
							onpointerenter={() => (active = i)}
						>
							<Poster src={entry.imageUrl} icon={category?.icon} title={entry.title} width={32} />
							<span class="grow">
								<span class="t truncate">{entry.title}</span>
								<span class="m">{[entry.year, entry.subtitle].filter(Boolean).join(' · ')}</span>
							</span>
						</div>
					{/each}
				{/if}

				{#if providerOn}
					<div class="group" role="presentation">
						From TMDB
						{#if pstate === 'loading'}<span class="spinner" aria-label="Searching"></span>{/if}
					</div>
					{#if pstate === 'offline' || !online}
						<div class="note">
							You're offline. It saves as a custom item and you can match it later.
						</div>
					{:else if pstate === 'error'}
						<div class="note">
							{perror || 'Search is unavailable'}. You can still save it as a custom item.
						</div>
					{:else if pstate === 'done' && !hits.length}
						<div class="note">TMDB has nothing by that name.</div>
					{/if}
					{#if online}
						{#each hits as hit, j (hit.source + hit.externalId + hit.kind)}
							{@const i = ownCount + catCount + j}
							<div
								id={optId(i)}
								class="opt"
								class:active={active === i}
								role="option"
								tabindex="-1"
								aria-selected={active === i}
								data-testid="capture-result-provider"
								onclick={() => void choose({ type: 'hit', hit })}
								onkeydown={() => {}}
								onpointerenter={() => (active = i)}
							>
								<Poster src={hit.imageUrl} icon={category?.icon} title={hit.title} width={32} />
								<span class="grow">
									<span class="t truncate">{hit.title}</span>
									<span class="m"
										>{[hit.year, kindLabel(hit.kind)].filter(Boolean).join(' · ')}</span
									>
								</span>
								{#if selecting === hit.externalId}<span class="spinner"></span>{/if}
							</div>
						{/each}
					{/if}
				{/if}

				<div
					id={optId(ownCount + catCount + hitCount)}
					class="opt custom"
					class:active={active === ownCount + catCount + hitCount}
					role="option"
					tabindex="-1"
					aria-selected={active === ownCount + catCount + hitCount}
					data-testid="capture-result-custom"
					onclick={() => void choose({ type: 'custom' })}
					onkeydown={() => {}}
					onpointerenter={() => (active = ownCount + catCount + hitCount)}
				>
					<span class="plus" aria-hidden="true"><Icon name="plus" size={18} /></span>
					<span class="grow"
						><span class="t">Add “{q}”</span><span class="m">as a custom item</span></span
					>
					<kbd class="hide-mobile">↵</kbd>
				</div>
			</div>
		{:else}
			<p class="tip faint small">
				Type a title and press <kbd>↵</kbd>.
				<span class="hide-mobile"
					><kbd>↑</kbd> <kbd>↓</kbd> move through results, <kbd>⌘</kbd><kbd>↵</kbd> saves without
					details, <kbd>Esc</kbd> closes.</span
				>
			</p>
		{/if}
	</div>
{:else if draft}
	<form
		class="context"
		onsubmit={(e) => {
			e.preventDefault();
			void save();
		}}
	>
		<div class="summary">
			<Poster src={draft.imageUrl} icon={category?.icon} title={draft.title} width={44} />
			<div class="grow">
				<div class="t">{draft.title}</div>
				<div class="m">{category?.icon} {category?.name} · {draft.sub}</div>
			</div>
			<button type="button" class="btn ghost sm" onclick={back}>Change</button>
		</div>
		{#if duplicate}
			<div class="notice dup" role="status">
				<Icon name="alert" size={18} />
				<p class="grow">
					<strong>You already saved this</strong> to {category?.name}
					{timeAgo(duplicate.createdAt)}{duplicate.recommendedBy
						? `, from ${duplicate.recommendedBy}`
						: ''}.
				</p>
				<a href="/i/{duplicate.id}" onclick={() => (capture.open = false)}>Open it</a>
			</div>
		{/if}

		<div class="grid">
			<div class="field">
				<label for="cap-by">Recommended by</label>
				<input
					id="cap-by"
					class="input"
					list="cap-by-list"
					bind:value={recommendedBy}
					placeholder="Sam"
					autocomplete="off"
				/>
				<datalist id="cap-by-list">
					{#each recommenders as r (r)}<option value={r}></option>{/each}
				</datalist>
			</div>
			<div class="field">
				<label for="cap-src">Source</label>
				<input
					id="cap-src"
					class="input"
					bind:value={source}
					placeholder="Podcast, link, walked past…"
					autocomplete="off"
				/>
			</div>
			<div class="field full">
				<label for="cap-why">Why</label>
				<textarea
					id="cap-why"
					class="textarea"
					rows="2"
					bind:value={why}
					placeholder="What made you want to try it?"
					onkeydown={(e) => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							void save();
						}
					}}></textarea>
			</div>
			<div class="field">
				<label for="cap-tags">Tags</label>
				<input
					id="cap-tags"
					class="input"
					bind:value={tagsText}
					placeholder="date night, cozy"
					autocomplete="off"
				/>
				{#if tagSuggestions.length}
					<div class="sugg">
						{#each tagSuggestions as t (t)}
							<button type="button" class="tag" onclick={() => addTag(t)}>#{t}</button>
						{/each}
					</div>
				{/if}
			</div>
			<div class="field">
				<label for="cap-status">Status</label>
				<select id="cap-status" class="select" bind:value={status}>
					{#each STATUSES as s (s)}<option value={s}>{STATUS_LABELS[s]}</option>{/each}
				</select>
			</div>
		</div>

		<div class="actions">
			<button type="button" class="btn ghost" onclick={back}>Back</button>
			<button
				bind:this={saveBtn}
				type="submit"
				class="btn primary lg"
				disabled={saving}
				data-testid="capture-save"
			>
				{#if saving}<span class="spinner"></span>{/if}Save
			</button>
		</div>
	</form>
{/if}

<style>
	.empty {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		align-items: flex-start;
	}
	.search {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}
	.inputrow {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		padding: var(--s-1) var(--s-1) var(--s-1) var(--s-3);
		border: 1.5px solid var(--border-strong);
		border-radius: var(--r-lg);
		background: var(--surface);
		transition:
			border-color var(--dur-1) ease,
			box-shadow var(--dur-1) ease;
	}
	.inputrow:focus-within {
		border-color: var(--accent);
		box-shadow: var(--ring);
	}
	.inputrow .cap-icon {
		display: grid;
		place-items: center;
		width: 28px;
		font-size: 20px;
		line-height: 1;
		color: var(--accent);
	}
	.capture-input {
		flex: 1;
		min-width: 0;
		height: 48px;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text);
		font-family: var(--font-serif);
		font-size: 1.375rem;
		font-weight: 500;
		letter-spacing: -0.01em;
	}
	.capture-input::placeholder {
		color: var(--text-3);
		font-style: italic;
	}
	.inputrow .btn {
		min-height: 44px;
		min-width: 72px;
	}
	.chips {
		display: flex;
		gap: var(--s-2);
		overflow-x: auto;
		scrollbar-width: none;
		margin: 0 calc(-1 * var(--s-5));
		padding: 2px var(--s-5);
	}
	.chips::-webkit-scrollbar {
		display: none;
	}
	.chips .chip {
		flex: none;
	}
	@media (min-width: 720px) {
		.chips {
			flex-wrap: wrap;
			margin: 0;
			padding: 0;
		}
	}
	.results {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: min(52dvh, 440px);
		overflow-y: auto;
		margin: 0 calc(-1 * var(--s-2));
		padding: 0 var(--s-2) var(--s-1);
	}
	.group {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--s-3) var(--s-2) var(--s-1);
		font-size: var(--fs-sm);
		font-weight: 650;
		color: var(--text-2);
	}
	.dupgroup {
		color: var(--warn);
	}
	.group .spinner {
		width: 12px;
		height: 12px;
	}
	.note {
		padding: var(--s-1) var(--s-2) var(--s-2);
		font-size: var(--fs-sm);
		color: var(--text-2);
	}
	.opt {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: 6px var(--s-2);
		border-radius: var(--r);
		cursor: pointer;
		min-height: 52px;
	}
	.opt.active {
		background: var(--surface-2);
	}
	/* Your own matches are a warning, so they sit on the notice tint and keep it when active. */
	.opt.own {
		background: var(--warn-soft);
		box-shadow: inset 0 0 0 1px var(--warn-border);
	}
	.opt.own.active {
		box-shadow: inset 0 0 0 2px var(--warn);
	}
	.opt.own + .opt.own {
		margin-top: 2px;
	}
	.t {
		display: block;
		font-weight: 600;
	}
	.m {
		display: block;
		font-size: var(--fs-sm);
		color: var(--text-2);
	}
	.m.warn {
		color: var(--warn);
	}
	.go {
		font-weight: 650;
		color: var(--warn);
	}
	.custom {
		margin-top: var(--s-2);
		border: 1px dashed var(--border-strong);
	}
	.custom.active {
		border-style: solid;
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.plus {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--r-xs);
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.custom .t {
		font-family: var(--font-serif);
		font-size: var(--fs-md);
		font-weight: 560;
	}
	.tip {
		padding: var(--s-1) 0;
		line-height: 1.8;
	}
	.hide-mobile {
		display: none;
	}
	@media (min-width: 720px) {
		.hide-mobile {
			display: inline;
		}
	}

	.context {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}
	.summary {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: var(--s-3);
		border-radius: var(--r-lg);
		background: var(--surface-2);
	}
	.summary .t {
		font-family: var(--font-serif);
		font-size: var(--fs-lg);
		font-weight: 560;
		line-height: 1.2;
		letter-spacing: -0.01em;
	}
	.dup {
		align-items: flex-start;
		animation: rise-in var(--dur-3) var(--ease-out);
	}
	.dup :global(.icon) {
		margin-top: 1px;
	}
	.dup strong {
		color: var(--warn);
		font-weight: 700;
	}
	.dup a {
		flex: none;
		font-weight: 700;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--s-3);
	}
	@media (min-width: 560px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
		.full {
			grid-column: 1 / -1;
		}
	}
	.sugg {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 2px;
	}
	.sugg .tag {
		min-height: 28px;
		border: none;
		cursor: pointer;
		font: inherit;
		font-size: var(--fs-xs);
	}
	.sugg .tag:hover {
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.actions {
		display: flex;
		justify-content: space-between;
		gap: var(--s-2);
	}
	.actions .primary {
		min-width: 140px;
	}
	@media (prefers-reduced-motion: reduce) {
		.dup {
			animation: fade-in var(--dur-2) ease;
		}
	}
</style>
