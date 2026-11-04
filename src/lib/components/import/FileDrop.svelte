<script lang="ts">
	// Drop zone + file picker. Calls onfiles with the chosen files.
	interface Props {
		accept: string;
		multiple?: boolean;
		disabled?: boolean;
		label: string;
		hint?: string;
		testid?: string;
		onfiles: (files: File[]) => void;
	}
	let {
		accept,
		multiple = false,
		disabled = false,
		label,
		hint,
		testid,
		onfiles
	}: Props = $props();

	let over = $state(false);
	let input = $state<HTMLInputElement>();

	function take(list: FileList | null | undefined) {
		const files = [...(list ?? [])];
		if (files.length && !disabled) onfiles(multiple ? files : files.slice(0, 1));
		if (input) input.value = '';
	}
	import Icon from '../Icon.svelte';
</script>

<label
	class="drop"
	class:over
	class:disabled
	ondragenter={(e) => {
		e.preventDefault();
		over = true;
	}}
	ondragover={(e) => e.preventDefault()}
	ondragleave={() => (over = false)}
	ondrop={(e) => {
		e.preventDefault();
		over = false;
		take(e.dataTransfer?.files);
	}}
>
	<input
		bind:this={input}
		class="sr-only"
		type="file"
		{accept}
		{multiple}
		{disabled}
		data-testid={testid}
		onchange={(e) => take(e.currentTarget.files)}
	/>
	<span class="ic" aria-hidden="true"><Icon name="upload" size={20} /></span>
	<span class="t">{label}</span>
	{#if hint}<span class="xs muted">{hint}</span>{/if}
	<span class="btn sm" aria-hidden="true">Choose file{multiple ? 's' : ''}</span>
</label>

<style>
	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--s-2);
		padding: var(--s-5) var(--s-4);
		border: 1.5px dashed var(--border-strong);
		border-radius: var(--r-lg);
		background: var(--surface-2);
		text-align: center;
		cursor: pointer;
	}
	.drop {
		transition:
			border-color var(--dur-1) ease,
			background-color var(--dur-1) ease;
	}
	.drop:hover:not(.disabled) {
		border-color: var(--text-3);
	}
	.ic {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--surface);
		color: var(--accent);
	}
	.drop:focus-within {
		box-shadow: var(--ring);
	}
	.drop.over {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.drop.disabled {
		opacity: 0.6;
		cursor: default;
	}
	.t {
		font-family: var(--font-serif);
		font-size: var(--fs-md);
		font-weight: 560;
	}
</style>
