<script lang="ts">
	import Modal from './Modal.svelte';
	import StarRating from './StarRating.svelte';
	import { saveLogEntry, today } from '#lib/client/mutations.ts';
	import { toast } from '#lib/client/ui.svelte.ts';
	import type { LogEntry } from '#lib/shared/types.ts';

	interface Props {
		open: boolean;
		itemId: string;
		entry?: LogEntry | null;
		title?: string;
		intro?: string;
		onclose: () => void;
	}
	let { open, itemId, entry = null, title, intro, onclose }: Props = $props();

	let date = $state(today());
	let rating = $state<number | null>(null);
	let note = $state('');
	$effect(() => {
		if (open) {
			date = entry?.date ?? today();
			rating = entry?.rating ?? null;
			note = entry?.note ?? '';
		}
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		try {
			await saveLogEntry({
				...(entry ? { id: entry.id } : {}),
				itemId,
				date: date || today(),
				rating,
				note: note.trim() || null
			});
			onclose();
		} catch (err) {
			toast(`Couldn't save: ${err instanceof Error ? err.message : err}`, { kind: 'error' });
		}
	}
</script>

<Modal
	{open}
	title={title ?? (entry ? 'Edit entry' : 'Log it')}
	size="sm"
	{onclose}
	testid="log-modal"
>
	<form id="log-form" class="stack" onsubmit={submit}>
		{#if intro}<p class="muted small">{intro}</p>{/if}
		<div class="field">
			<label for="log-date">Date</label>
			<input id="log-date" class="input" type="date" bind:value={date} max={today()} required />
		</div>
		<div class="field">
			<span class="label" id="log-rating-l">Rating</span>
			<StarRating value={rating} onchange={(v) => (rating = v)} size={30} label="Rating" />
		</div>
		<div class="field">
			<label for="log-note">Note</label>
			<textarea
				id="log-note"
				class="textarea"
				bind:value={note}
				rows="3"
				placeholder="What did you think?"></textarea>
		</div>
	</form>
	{#snippet footer()}
		<button type="button" class="btn" onclick={onclose}>{entry ? 'Cancel' : 'Skip'}</button>
		<button type="submit" form="log-form" class="btn primary" data-autofocus data-testid="log-save"
			>Save entry</button
		>
	{/snippet}
</Modal>
