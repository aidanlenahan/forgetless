<script lang="ts">
	import Modal from './Modal.svelte';
	import Poster from './Poster.svelte';
	import Icon from './Icon.svelte';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { store } from '#lib/client/store.svelte.ts';
	import { pickWeighted } from '#lib/client/pick.ts';
	import { timeAgo } from '#lib/client/format.ts';
	import { kindLabel } from '#lib/client/provider.ts';
	import { tintStyle } from '#lib/client/visual.ts';
	import type { Item } from '#lib/shared/types.ts';

	interface Props {
		open: boolean;
		items: Item[];
		onclose: () => void;
	}
	let { open, items, onclose }: Props = $props();

	let picked = $state<Item | null>(null);
	let rolls = $state(0);

	$effect(() => {
		if (open) {
			picked = untrack(() => pickWeighted(items));
			rolls = 0;
		}
	});
	function reroll() {
		picked = pickWeighted(items, { excludeId: picked?.id });
		rolls++;
	}
	const entry = $derived(
		picked?.catalogEntryId ? store.catalog.get(picked.catalogEntryId) : undefined
	);
	const cat = $derived(picked ? store.categoryById.get(picked.categoryId) : undefined);
	const overview = $derived(
		typeof entry?.data?.overview === 'string' ? (entry.data.overview as string) : null
	);
</script>

<Modal {open} title="Pick for me" size="sm" {onclose} testid="pick-modal">
	{#if picked}
		<div class="deck" style={tintStyle(cat)}>
			<span class="back b2" aria-hidden="true"></span>
			<span class="back b1" aria-hidden="true"></span>
			{#key picked.id + rolls}
				<div class="pick" class:alt={rolls % 2 === 1} aria-live="polite">
					<span class="art">
						<Poster
							src={entry?.imageUrl}
							icon={cat?.icon}
							title={picked.title}
							width={132}
							radius="var(--r-xs)"
							eager
						/>
					</span>
					<div class="info">
						<div class="cat small muted">
							<span aria-hidden="true">{cat?.icon}</span>
							{cat?.name}{#if entry}<span class="dot">·</span>{[entry.year, kindLabel(entry.kind)]
									.filter(Boolean)
									.join(' · ')}{/if}
						</div>
						<h3 data-testid="pick-title">{picked.title}</h3>
						{#if picked.why}
							<p class="why">“{picked.why}”</p>
						{:else if overview}
							<p class="ov small muted">{overview}</p>
						{/if}
						<div class="small muted byline">
							{#if picked.recommendedBy}<span class="by">from {picked.recommendedBy}</span>{/if}
							<span>saved {timeAgo(picked.createdAt)}</span>
						</div>
					</div>
				</div>
			{/key}
		</div>
		<p class="faint xs center">
			Picked from {items.length}
			{items.length === 1 ? 'item' : 'items'} in this view. Older saves come up more often.
		</p>
	{:else}
		<p class="muted">Nothing matches your current filters.</p>
	{/if}
	{#snippet footer()}
		<button
			type="button"
			class="btn"
			onclick={reroll}
			disabled={items.length < 2}
			data-testid="pick-reroll"><Icon name="reroll" size={17} /> Another</button
		>
		<button
			type="button"
			class="btn primary"
			data-autofocus
			disabled={!picked}
			onclick={() => {
				const id = picked?.id;
				onclose();
				if (id) void goto(`/i/${id}`);
			}}>Open it</button
		>
	{/snippet}
</Modal>

<style>
	.deck {
		position: relative;
		display: grid;
		margin: var(--s-2) var(--s-1) var(--s-4);
	}
	/* Two cards peek out behind the pick, like a hand of index cards. */
	.back {
		grid-area: 1 / 1;
		border-radius: var(--r-lg);
		background: var(--tint-bg, var(--surface-2));
		border: 1px solid var(--border);
	}
	.b1 {
		transform: rotate(2.2deg) translate(4px, 4px);
		opacity: 0.85;
	}
	.b2 {
		transform: rotate(-2.6deg) translate(-4px, 6px);
		opacity: 0.6;
	}
	.pick {
		grid-area: 1 / 1;
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--s-4);
		padding: var(--s-5) var(--s-4) var(--s-4);
		border-radius: var(--r-lg);
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: var(--shadow);
		animation: deal 460ms var(--ease-out) both;
	}
	.pick.alt {
		animation-name: deal-alt;
	}
	/* The poster uncovers from the top a beat after the card lands. */
	.art {
		display: block;
		animation: uncover 520ms var(--ease-out) 90ms both;
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		align-items: center;
		animation: fade-in 360ms ease 160ms both;
	}
	.cat {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dot {
		margin: 0 2px;
		color: var(--text-3);
	}
	h3 {
		font-family: var(--font-serif);
		font-size: 1.75rem;
		font-weight: 560;
		line-height: 1.1;
		letter-spacing: -0.015em;
		text-wrap: balance;
		overflow-wrap: anywhere;
	}
	.why {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: var(--fs-md);
		line-height: 1.4;
		color: var(--text);
		max-width: 32ch;
	}
	.byline span + span::before {
		content: '·';
		margin: 0 6px;
		color: var(--text-3);
	}
	.by {
		font-family: var(--font-serif);
		font-style: italic;
		color: var(--text);
	}
	.ov {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.center {
		text-align: center;
		text-wrap: balance;
	}
	@keyframes deal {
		from {
			opacity: 0;
			transform: translate(-28px, 14px) rotate(-6deg) scale(0.96);
		}
	}
	@keyframes deal-alt {
		from {
			opacity: 0;
			transform: translate(28px, 14px) rotate(6deg) scale(0.96);
		}
	}
	@keyframes uncover {
		from {
			clip-path: inset(0 0 100% 0);
		}
		to {
			clip-path: inset(0 0 0 0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pick,
		.pick.alt {
			animation: fade-in 200ms ease both;
		}
		.art {
			animation: none;
		}
		.info {
			animation: none;
		}
	}
</style>
