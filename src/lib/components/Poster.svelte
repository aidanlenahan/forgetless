<script lang="ts">
	// Poster thumbnail. TMDB images are requested at the rendered size (1x/2x); everything else gets a
	// typographic placeholder: the title's initial set in the serif on the category's tint, with its emoji.
	import { posterSources, initialOf } from '#lib/client/visual.ts';

	interface Props {
		src?: string | null;
		alt?: string;
		icon?: string;
		/** Title used for the placeholder initial. */
		title?: string | null;
		width?: number;
		ratio?: number; // height / width
		radius?: string;
		/** Load immediately (above-the-fold hero images). */
		eager?: boolean;
	}
	let {
		src,
		alt = '',
		icon = '📌',
		title = null,
		width = 44,
		ratio = 1.5,
		radius = 'var(--r-xs)',
		eager = false
	}: Props = $props();
	let failed = $state(false);
	$effect(() => {
		void src;
		failed = false;
	});
	const height = $derived(Math.round(width * ratio));
	const sources = $derived(posterSources(src, width));
	const initial = $derived(initialOf(title));
</script>

<span
	class="poster"
	class:ph={!sources || failed}
	style:width="{width}px"
	style:height="{height}px"
	style:border-radius={radius}
>
	{#if sources && !failed}
		<img
			src={sources.src}
			srcset={sources.srcset}
			{alt}
			{width}
			{height}
			loading={eager ? 'eager' : 'lazy'}
			fetchpriority={eager ? 'high' : undefined}
			decoding="async"
			onerror={() => (failed = true)}
		/>
	{:else if initial && width >= 40}
		<span class="poster-initial" style:font-size="{Math.round(width * 0.62)}px" aria-hidden="true"
			>{initial}</span
		>
		<span
			class="poster-badge"
			style:font-size="{Math.max(11, Math.round(width * 0.2))}px"
			aria-hidden="true">{icon}</span
		>
	{:else}
		<span class="poster-fallback" style:font-size="{Math.round(width * 0.5)}px" aria-hidden="true"
			>{icon}</span
		>
	{/if}
</span>
