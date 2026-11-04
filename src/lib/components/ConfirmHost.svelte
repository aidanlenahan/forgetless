<script lang="ts">
	import Modal from './Modal.svelte';
	import { confirmState } from '#lib/client/ui.svelte.ts';

	function done(ok: boolean) {
		const r = confirmState.req;
		confirmState.req = null;
		r?.resolve(ok);
	}
</script>

<Modal
	open={!!confirmState.req}
	title={confirmState.req?.title ?? ''}
	size="sm"
	onclose={() => done(false)}
	testid="confirm-dialog"
>
	{#if confirmState.req?.message}<p class="muted">{confirmState.req.message}</p>{/if}
	{#snippet footer()}
		<button type="button" class="btn" onclick={() => done(false)}>Cancel</button>
		<button
			type="button"
			class="btn primary"
			class:danger={confirmState.req?.danger}
			data-autofocus
			data-testid="confirm-ok"
			onclick={() => done(true)}>{confirmState.req?.confirmLabel ?? 'OK'}</button
		>
	{/snippet}
</Modal>
