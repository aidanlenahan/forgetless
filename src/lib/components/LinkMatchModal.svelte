<script lang="ts">
	// Link a custom / needs-match item to a provider entry (TMDB title or OpenStreetMap place).
	import Modal from './Modal.svelte';
	import Poster from './Poster.svelte';
	import {
		searchProvider,
		selectProviderHit,
		kindLabel,
		placePreference,
		OSM_ATTRIBUTION
	} from '#lib/client/provider.ts';
	import { nearMePos, ensurePosition } from '#lib/client/location.svelte.ts';
	import { store } from '#lib/client/store.svelte.ts';
	import { saveItem } from '#lib/client/mutations.ts';
	import { toast } from '#lib/client/ui.svelte.ts';
	import type { CatalogHit, Item } from '#lib/shared/types.ts';

	interface Props {
		open: boolean;
		item: Item;
		/** Provider id of the item's category ('tmdb' or 'osm'). */
		provider?: string;
		onclose: () => void;
	}
	let { open, item, provider = 'tmdb', onclose }: Props = $props();
	const places = $derived(provider === 'osm');
	const category = $derived(store.categoryById.get(item.categoryId));
	const name = $derived(places ? 'OpenStreetMap' : 'TMDB');
	$effect(() => {
		if (open && places) void ensurePosition();
	});

	let q = $state('');
	let hits = $state<CatalogHit[]>([]);
	let loading = $state(false);
	let error = $state('');
	let selecting = $state<string | null>(null);

	$effect(() => {
		if (open) q = item.title;
	});

	$effect(() => {
		const text = q.trim();
		if (!open || text.length < 2) {
			hits = [];
			return;
		}
		loading = true;
		error = '';
		const ctrl = new AbortController();
		const t = setTimeout(async () => {
			try {
				const bias = places ? nearMePos() : null;
				const extras = places
					? { lat: bias?.lat, lon: bias?.lon, prefer: placePreference(category) }
					: {};
				hits = (await searchProvider(provider, text, ctrl.signal, extras)).slice(0, 10);
			} catch (e) {
				if (ctrl.signal.aborted) return;
				hits = [];
				error = navigator.onLine
					? e instanceof Error
						? e.message
						: 'Search failed'
					: "You're offline. Try again when you're connected.";
			} finally {
				if (!ctrl.signal.aborted) loading = false;
			}
		}, 250);
		return () => {
			clearTimeout(t);
			ctrl.abort();
		};
	});

	async function pick(hit: CatalogHit) {
		selecting = hit.externalId;
		try {
			const entry = await selectProviderHit(provider, hit);
			await saveItem({
				...item,
				title: entry.title || item.title,
				catalogEntryId: entry.id,
				needsMatch: false
			});
			toast(places ? 'Linked to the place' : 'Linked to TMDB', { kind: 'success' });
			onclose();
		} catch (e) {
			toast(e instanceof Error ? e.message : "Couldn't link it", { kind: 'error' });
		} finally {
			selecting = null;
		}
	}
</script>

<Modal
	{open}
	title={places ? 'Link to a place' : 'Find it on TMDB'}
	size="md"
	placement="top"
	{onclose}
	testid="link-modal"
>
	<div class="stack">
		<div class="row">
			<input
				class="input"
				type="search"
				bind:value={q}
				aria-label="Search {name}"
				data-autofocus
				placeholder={places ? 'Search places' : 'Search TMDB'}
			/>
			{#if loading}<span class="spinner"></span>{/if}
		</div>
		{#if error}<p class="small muted">{error}</p>{/if}
		<ul class="hits">
			{#each hits as hit (hit.externalId + hit.kind)}
				<li>
					<button
						type="button"
						class="hit"
						onclick={() => pick(hit)}
						disabled={!!selecting}
						data-testid="link-hit"
					>
						{#if places}
							<span class="placeicon" aria-hidden="true">{category?.icon ?? '📍'}</span>
						{:else}
							<Poster src={hit.imageUrl} title={hit.title} width={36} />
						{/if}
						<span class="grow">
							<span class="t">{hit.title}</span>
							<span class="m"
								>{places
									? hit.subtitle || kindLabel(hit.kind)
									: [hit.year, kindLabel(hit.kind)].filter(Boolean).join(' · ')}</span
							>
						</span>
						{#if selecting === hit.externalId}<span class="spinner"></span>{/if}
					</button>
				</li>
			{:else}
				{#if !loading && !error && q.trim().length >= 2}<li class="small muted">
						{places ? 'No places by that name.' : 'TMDB has nothing by that name.'}
					</li>{/if}
			{/each}
		</ul>
		{#if places && hits.length}
			<p class="xs faint attr">
				Place data <a href={OSM_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer"
					>{OSM_ATTRIBUTION.text}</a
				>
			</p>
		{/if}
	</div>
</Modal>

<style>
	.hits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.hit {
		width: 100%;
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: var(--s-2);
		border: none;
		border-radius: var(--r);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.hit {
		min-height: 64px;
		transition: background-color var(--dur-1) ease;
	}
	.hit:hover,
	.hit:focus-visible {
		background: var(--surface-2);
	}
	.t {
		display: block;
		font-family: var(--font-serif);
		font-size: var(--fs-md);
		font-weight: 560;
	}
	.m {
		display: block;
		font-size: var(--fs-sm);
		color: var(--text-2);
	}
	.placeicon {
		flex: none;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: var(--r-sm);
		background: var(--surface-2);
		font-size: 18px;
		line-height: 1;
	}
	.attr a {
		color: inherit;
		text-decoration: underline;
	}
</style>
