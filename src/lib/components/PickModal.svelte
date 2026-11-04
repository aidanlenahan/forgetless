<script lang="ts">
	import Modal from './Modal.svelte';
	import Poster from './Poster.svelte';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { store } from '#lib/client/store.svelte.ts';
	import { pickWeighted } from '#lib/client/pick.ts';
	import { timeAgo } from '#lib/client/format.ts';
	import { kindLabel } from '#lib/client/provider.ts';
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
		{#key picked.id + rolls}
			<div class="pick">
				<Poster src={entry?.imageUrl} icon={cat?.icon} width={120} radius="var(--r)" />
				<div class="info">
					<div class="cat small muted">{cat?.icon} {cat?.name}</div>
					<h3 data-testid="pick-title">{picked.title}</h3>
					{#if entry}<div class="small muted">
							{[entry.year, kindLabel(entry.kind)].filter(Boolean).join(' · ')}
						</div>{/if}
					<div class="small faint">
						Added {timeAgo(picked.createdAt)}{picked.recommendedBy
							? ` · from ${picked.recommendedBy}`
							: ''}
					</div>
					{#if picked.why}<p class="why">“{picked.why}”</p>{:else if overview}<p
							class="ov small muted"
						>
							{overview}
						</p>{/if}
				</div>
			</div>
		{/key}
		<p class="faint xs center">
			From {items.length} item{items.length === 1 ? '' : 's'} matching your filters · older ones are more
			likely
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
			data-testid="pick-reroll">↻ Re-roll</button
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
			}}>Open</button
		>
	{/snippet}
</Modal>

<style>
	.pick {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--s-4);
		padding: var(--s-2) 0 var(--s-4);
		animation: deal 0.35s var(--ease);
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		align-items: center;
	}
	h3 {
		font-size: var(--fs-lg);
	}
	.why {
		margin-top: var(--s-2);
		font-style: italic;
		color: var(--text-2);
	}
	.ov {
		margin-top: var(--s-2);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.center {
		text-align: center;
	}
	@keyframes deal {
		from {
			transform: translateY(8px) rotate(-1.5deg) scale(0.97);
			opacity: 0;
		}
	}
</style>
