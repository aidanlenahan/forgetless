<script lang="ts">
	// 5-star rating with half steps. Value is stored 1–10 (null = no rating).
	// Click the left/right half of a star; keyboard: arrows (±½), Home/End, Delete/Backspace clears.
	interface Props {
		value: number | null;
		onchange?: (v: number | null) => void;
		readonly?: boolean;
		size?: number;
		label?: string;
	}
	let { value, onchange, readonly = false, size = 22, label = 'Rating' }: Props = $props();

	let hover = $state<number | null>(null);
	const shown = $derived(hover ?? value ?? 0);
	const fill = (i: number) => Math.max(0, Math.min(1, (shown - (i - 1) * 2) / 2)); // 0, .5, 1

	function set(v: number | null) {
		if (readonly) return;
		onchange?.(v);
	}
	function valueAt(e: MouseEvent | PointerEvent, i: number) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const left = e.clientX - r.left < r.width / 2;
		return (i - 1) * 2 + (left ? 1 : 2);
	}
	function onKey(e: KeyboardEvent) {
		if (readonly) return;
		const v = value ?? 0;
		let next: number | null | undefined;
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(10, v + 1);
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = v - 1 < 1 ? null : v - 1;
		else if (e.key === 'Home') next = 1;
		else if (e.key === 'End') next = 10;
		else if (e.key === 'Delete' || e.key === 'Backspace' || e.key === '0') next = null;
		else if (/^[1-5]$/.test(e.key)) next = Number(e.key) * 2;
		if (next !== undefined) {
			e.preventDefault();
			set(next);
		}
	}
	const text = $derived(value == null ? 'No rating' : `${value / 2} out of 5 stars`);
</script>

{#snippet star(f: number)}
	<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
		<path
			class="star-bg"
			d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"
		/>
		{#if f >= 1}
			<path
				class="star-fg"
				d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"
			/>
		{:else if f > 0}
			<path class="star-fg" d="M12 2.6L9.1 8.5l-6.5.9 4.7 4.6-1.1 6.5L12 17.4z" />
		{/if}
	</svg>
{/snippet}

{#if readonly}
	<span class="stars ro" role="img" aria-label={text} title={text}>
		{#each [1, 2, 3, 4, 5] as i (i)}{@render star(fill(i))}{/each}
	</span>
{:else}
	<span class="stars-wrap">
		<span
			class="stars"
			role="slider"
			tabindex="0"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={5}
			aria-valuenow={(value ?? 0) / 2}
			aria-valuetext={text}
			onkeydown={onKey}
			onpointerleave={() => (hover = null)}
		>
			{#each [1, 2, 3, 4, 5] as i (i)}
				<span
					class="star-hit"
					role="presentation"
					onpointermove={(e) => (hover = valueAt(e, i))}
					onclick={(e) => {
						const v = valueAt(e, i);
						set(v === value ? null : v);
					}}
				>
					{@render star(fill(i))}
				</span>
			{/each}
		</span>
		{#if value != null}
			<button type="button" class="stars-clear" onclick={() => set(null)} aria-label="Clear rating"
				>Clear</button
			>
		{/if}
	</span>
{/if}
