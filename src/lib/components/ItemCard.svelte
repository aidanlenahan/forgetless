<script lang="ts">
	import Poster from './Poster.svelte';
	import StarRating from './StarRating.svelte';
	import { STATUS_LABELS, type Category, type CatalogEntry, type Item } from '#lib/shared/types.ts';
	import { entryMeta } from '#lib/client/provider.ts';
	import { tintStyle } from '#lib/client/visual.ts';

	interface Props {
		item: Item;
		category?: Category;
		entry?: CatalogEntry;
		rating?: number | null;
		showCategory?: boolean;
		/** 'row' for the list, 'tile' for the poster grid. */
		variant?: 'row' | 'tile';
	}
	let {
		item,
		category,
		entry,
		rating = null,
		showCategory = false,
		variant = 'row'
	}: Props = $props();

	const sub = $derived(entryMeta(entry));
	// Items captured in the last few seconds get a short arrival highlight.
	const fresh = $derived(Date.now() - item.createdAt < 4000);
</script>

{#if variant === 'tile'}
	<a
		class="tile"
		class:fresh
		href="/i/{item.id}"
		data-testid="item-card"
		style={tintStyle(category)}
	>
		<span class="art">
			<Poster
				src={entry?.imageUrl}
				icon={category?.icon ?? '📌'}
				title={item.title}
				width={168}
				ratio={1.5}
			/>
			{#if item.status !== 'want'}<span class="pill {item.status} onart"
					>{STATUS_LABELS[item.status]}</span
				>{/if}
		</span>
		<span class="ttl">{item.title}</span>
		<span class="tmeta">
			{#if item.recommendedBy}<span class="by truncate">from {item.recommendedBy}</span
				>{:else if sub}<span class="truncate">{sub}</span>{/if}
			{#if rating != null}<StarRating value={rating} readonly size={12} />{/if}
		</span>
	</a>
{:else}
	<a
		class="item"
		class:fresh
		href="/i/{item.id}"
		data-testid="item-card"
		style={tintStyle(category)}
	>
		<Poster src={entry?.imageUrl} icon={category?.icon ?? '📌'} title={item.title} width={48} />
		<span class="main">
			<span class="title">{item.title}</span>
			<span class="meta">
				{#if showCategory && category}<span class="cat"
						><span aria-hidden="true">{category.icon}</span> {category.name}</span
					>{/if}
				{#if sub}<span class="truncate">{sub}</span>{/if}
				{#if item.recommendedBy}<span class="by truncate">from {item.recommendedBy}</span>{/if}
				{#if item.needsMatch}<span class="match">needs a match</span>{/if}
			</span>
			{#if item.tags.length}
				<span class="tags">
					{#each item.tags.slice(0, 4) as t (t)}<span class="tag">#{t}</span>{/each}
				</span>
			{/if}
		</span>
		<span class="side">
			{#if item.status !== 'want'}<span class="pill {item.status}"
					>{STATUS_LABELS[item.status]}</span
				>{/if}
			{#if rating != null}<StarRating value={rating} readonly size={13} />{/if}
		</span>
	</a>
{/if}

<style>
	.item {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--s-4);
		padding: var(--s-3);
		border-radius: var(--r);
		color: inherit;
		text-decoration: none;
		min-width: 0;
		transition: background-color var(--dur-1) ease;
	}
	@media (hover: hover) {
		.item:hover {
			background: var(--surface-hover);
			text-decoration: none;
		}
	}
	.item:active {
		background: var(--surface-2);
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.title {
		font-family: var(--font-serif);
		font-size: var(--fs-item);
		font-weight: 560;
		line-height: 1.25;
		letter-spacing: -0.005em;
		color: var(--text);
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
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
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 0.95rem;
		line-height: 1.3;
		color: var(--text);
	}
	.match {
		color: var(--warn);
		font-weight: 600;
	}
	.tags {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		margin-top: 3px;
	}
	.side {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--s-1);
		flex: none;
	}

	/* Poster grid tile */
	.tile {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}
	.art {
		position: relative;
		display: block;
		border-radius: var(--r-xs);
		transition: transform var(--dur-2) var(--ease-out);
	}
	.art :global(.poster) {
		width: 100% !important;
		height: auto !important;
		aspect-ratio: 2 / 3;
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent),
			0 1px 2px rgb(40 25 10 / 0.08);
	}
	@media (hover: hover) {
		.tile:hover {
			text-decoration: none;
		}
		.tile:hover .art {
			transform: translateY(-2px);
		}
	}
	.tile:active .art {
		transform: scale(0.98);
	}
	.onart {
		position: absolute;
		left: 6px;
		bottom: 6px;
		box-shadow: var(--shadow-sm);
	}
	.ttl {
		font-family: var(--font-serif);
		font-size: var(--fs-md);
		font-weight: 560;
		line-height: 1.2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.tmeta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-2);
		min-width: 0;
		font-size: var(--fs-sm);
		color: var(--text-2);
		margin-top: -2px;
	}

	/* Arrival: a just-captured item rises in and its row glows once in the accent tint. */
	.fresh {
		animation: arrive 520ms var(--ease-out);
	}
	.item.fresh {
		animation:
			arrive 520ms var(--ease-out),
			glow 1600ms ease-out;
	}
	@keyframes arrive {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
	@keyframes glow {
		from {
			background-color: var(--accent-soft);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fresh,
		.item.fresh {
			animation: glow 1600ms ease-out;
		}
		.tile:hover .art,
		.tile:active .art {
			transform: none;
		}
	}
</style>
