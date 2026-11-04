<script lang="ts">
	// Poster thumbnail with a soft emoji fallback.
	interface Props {
		src?: string | null;
		alt?: string;
		icon?: string;
		width?: number;
		ratio?: number; // height / width
		radius?: string;
	}
	let {
		src,
		alt = '',
		icon = '📌',
		width = 44,
		ratio = 1.5,
		radius = 'var(--r-sm)'
	}: Props = $props();
	let failed = $state(false);
	$effect(() => {
		void src;
		failed = false;
	});
</script>

<span
	class="poster"
	style:width="{width}px"
	style:height="{Math.round(width * ratio)}px"
	style:border-radius={radius}
>
	{#if src && !failed}
		<img {src} {alt} loading="lazy" decoding="async" onerror={() => (failed = true)} />
	{:else}
		<span class="fallback" style:font-size="{Math.round(width * 0.5)}px" aria-hidden="true"
			>{icon}</span
		>
	{/if}
</span>

<style>
	.poster {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: var(--surface-2);
		border: 1px solid var(--border);
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.fallback {
		line-height: 1;
	}
</style>
