<script lang="ts">
	// Emoji icon picker: a free-form emoji input plus a small preset palette.
	interface Props {
		value: string;
		onchange: (v: string) => void;
		label?: string;
	}
	let { value, onchange, label = 'Icon' }: Props = $props();
	const PRESETS = [
		'🎬',
		'📺',
		'📚',
		'🍜',
		'🍕',
		'🍣',
		'☕',
		'🍸',
		'🍷',
		'🍳',
		'🧁',
		'📍',
		'🏔️',
		'🏛️',
		'✈️',
		'🎮',
		'🎲',
		'🎧',
		'🎵',
		'🎨',
		'🛍️',
		'🏋️',
		'🌱',
		'🎟️',
		'🎙️',
		'💡',
		'📌',
		'⭐'
	];
	let open = $state(false);
	let root = $state<HTMLElement>();
	let custom = $state('');

	$effect(() => {
		if (!open) return;
		const onDoc = (e: Event) => {
			if (root && !root.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				open = false;
			}
		};
		document.addEventListener('pointerdown', onDoc);
		document.addEventListener('keydown', onKey, true);
		return () => {
			document.removeEventListener('pointerdown', onDoc);
			document.removeEventListener('keydown', onKey, true);
		};
	});

	function choose(v: string) {
		const t = v.trim();
		if (!t) return;
		// Keep the first grapheme (an emoji may be several code points).
		const seg =
			typeof Intl !== 'undefined' && 'Segmenter' in Intl
				? [...new Intl.Segmenter().segment(t)][0]?.segment
				: [...t][0];
		onchange(seg || t);
		open = false;
		custom = '';
	}
</script>

<div class="ip" bind:this={root}>
	<button
		type="button"
		class="btn icon trigger"
		aria-label="{label}: {value}. Change icon"
		aria-expanded={open}
		onclick={() => (open = !open)}>{value}</button
	>
	{#if open}
		<div class="pop" role="dialog" aria-label="Choose an icon">
			<div class="grid">
				{#each PRESETS as p (p)}
					<button
						type="button"
						class="em"
						class:on={p === value}
						onclick={() => choose(p)}
						aria-label={p}>{p}</button
					>
				{/each}
			</div>
			<form
				class="row"
				onsubmit={(e) => {
					e.preventDefault();
					choose(custom);
				}}
			>
				<input
					class="input sm"
					bind:value={custom}
					placeholder="Any emoji…"
					aria-label="Custom emoji"
					maxlength="16"
				/>
				<button class="btn sm">Use</button>
			</form>
		</div>
	{/if}
</div>

<style>
	.ip {
		position: relative;
	}
	.trigger {
		font-size: 18px;
	}
	.pop {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 30;
		width: 260px;
		padding: var(--s-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}
	.em {
		aspect-ratio: 1;
		border: none;
		border-radius: var(--r-sm);
		background: transparent;
		font-size: 18px;
		cursor: pointer;
		padding: 0;
	}
	.em:hover,
	.em.on {
		background: var(--surface-2);
	}
	.em.on {
		box-shadow: inset 0 0 0 1px var(--accent);
	}
</style>
