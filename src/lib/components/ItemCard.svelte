<script lang="ts">
	import Poster from './Poster.svelte';
	import StarRating from './StarRating.svelte';
	import { STATUS_LABELS, type Category, type CatalogEntry, type Item } from '#lib/shared/types.ts';
	import { entryMeta } from '#lib/client/provider.ts';

	interface Props {
		item: Item;
		category?: Category;
		entry?: CatalogEntry;
		rating?: number | null;
		showCategory?: boolean;
	}
	let { item, category, entry, rating = null, showCategory = false }: Props = $props();

	const sub = $derived(entryMeta(entry));
</script>

<a class="item" href="/i/{item.id}" data-testid="item-card">
	<Poster src={entry?.imageUrl} icon={category?.icon ?? '📌'} width={44} />
	<span class="main">
		<span class="title truncate">{item.title}</span>
		<span class="meta">
			{#if showCategory && category}<span class="cat">{category.icon} {category.name}</span>{/if}
			{#if sub}<span class="truncate">{sub}</span>{/if}
			{#if item.recommendedBy}<span class="by truncate">from {item.recommendedBy}</span>{/if}
			{#if item.needsMatch}<span class="match">needs match</span>{/if}
		</span>
		{#if item.tags.length}
			<span class="tags">
				{#each item.tags.slice(0, 4) as t (t)}<span class="tag">#{t}</span>{/each}
			</span>
		{/if}
	</span>
	<span class="side">
		{#if item.status !== 'want'}<span class="pill {item.status}">{STATUS_LABELS[item.status]}</span
			>{/if}
		{#if rating != null}<StarRating value={rating} readonly size={13} />{/if}
	</span>
</a>

<style>
	.item {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: var(--s-3);
		border-radius: var(--r-lg);
		color: inherit;
		text-decoration: none;
		transition: background 0.12s;
		min-width: 0;
	}
	.item:hover {
		background: var(--surface-hover);
		text-decoration: none;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.title {
		font-weight: 600;
		font-size: var(--fs);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		column-gap: var(--s-2);
		row-gap: 0;
		font-size: var(--fs-sm);
		color: var(--text-2);
		min-width: 0;
	}
	.meta > span:not(:first-child)::before {
		content: '·';
		margin-right: var(--s-2);
		color: var(--text-3);
	}
	.by {
		color: var(--text-2);
	}
	.match {
		color: var(--warn);
	}
	.tags {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		margin-top: 2px;
	}
	.side {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--s-1);
		flex: none;
	}
</style>
