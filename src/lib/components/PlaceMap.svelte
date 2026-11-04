<script lang="ts">
	// A small static map with no map library: a 3×3 block of 256px tiles positioned with CSS so the place
	// sits in the centre under a pin. Tiles load only once the map scrolls into view (and are cached by the
	// service worker), which keeps us well inside the OSM tile usage policy. Attribution is required.
	import { tileGrid, tileUrl, OSM_ATTRIBUTION } from '#lib/shared/places.ts';

	interface Props {
		lat: number;
		lon: number;
		/** Tile URL template with {z}/{x}/{y}. */
		template: string;
		/** Where a click on the map goes (the place on openstreetmap.org). */
		href?: string | null;
		label?: string;
		zoom?: number;
	}
	let { lat, lon, template, href = null, label = 'Map', zoom = 16 }: Props = $props();

	const tiles = $derived(tileGrid({ lat, lon }, zoom, 3, 3));
	let el = $state<HTMLElement>();
	let visible = $state(false);
	let failed = $state(0);

	$effect(() => {
		if (!el || visible) return;
		if (typeof IntersectionObserver === 'undefined') {
			visible = true;
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					visible = true;
					io.disconnect();
				}
			},
			{ rootMargin: '200px' }
		);
		io.observe(el);
		return () => io.disconnect();
	});
</script>

<figure class="placemap" bind:this={el} data-testid="place-map">
	<svelte:element
		this={href ? 'a' : 'div'}
		class="tiles"
		href={href ?? undefined}
		target={href ? '_blank' : undefined}
		rel={href ? 'noopener noreferrer' : undefined}
		aria-label={href ? `${label}: open in OpenStreetMap` : label}
		role={href ? undefined : 'img'}
	>
		{#if visible && failed < tiles.length}
			{#each tiles as t (`${t.z}/${t.x}/${t.y}`)}
				<img
					src={tileUrl(template, t)}
					alt=""
					width="256"
					height="256"
					loading="lazy"
					decoding="async"
					referrerpolicy="strict-origin-when-cross-origin"
					draggable="false"
					style:left="calc(50% + {t.left}px)"
					style:top="calc(50% + {t.top}px)"
					onerror={() => (failed += 1)}
				/>
			{/each}
		{/if}
		<svg class="pin" width="30" height="40" viewBox="0 0 30 40" aria-hidden="true">
			<path
				d="M15 39s13-13.2 13-23.5A13 13 0 0 0 2 15.5C2 25.8 15 39 15 39Z"
				fill="var(--accent)"
				stroke="var(--surface)"
				stroke-width="2"
			/>
			<circle cx="15" cy="15.5" r="4.8" fill="var(--surface)" />
		</svg>
	</svelte:element>
	<figcaption class="credit">
		<a href={OSM_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer"
			>{OSM_ATTRIBUTION.text}</a
		>
	</figcaption>
</figure>

<style>
	.placemap {
		position: relative;
		margin: 0;
		width: 100%;
		max-width: 512px;
		height: 208px;
		border-radius: var(--r-lg);
		overflow: hidden;
		border: 1px solid var(--border);
		background:
			repeating-linear-gradient(
				45deg,
				transparent 0 10px,
				color-mix(in srgb, var(--text) 3%, transparent) 10px 20px
			),
			var(--surface-2);
	}
	.tiles {
		position: absolute;
		inset: 0;
		display: block;
		overflow: hidden;
	}
	.tiles img {
		position: absolute;
		width: 256px;
		height: 256px;
		max-width: none;
		user-select: none;
		/* Warm the default OSM style a touch so it sits with the paper palette. */
		filter: sepia(0.18) saturate(0.85);
	}
	.pin {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -100%);
		filter: drop-shadow(0 2px 3px rgb(40 25 10 / 0.35));
	}
	.credit {
		position: absolute;
		right: 0;
		bottom: 0;
		padding: 2px 6px;
		border-top-left-radius: var(--r-sm);
		background: color-mix(in srgb, var(--surface) 86%, transparent);
		font-size: 11px;
		line-height: 1.4;
		color: var(--text-2);
	}
	.credit a {
		color: inherit;
	}
	@media (prefers-color-scheme: dark) {
		.tiles img {
			filter: brightness(0.82) contrast(1.05) sepia(0.2);
		}
	}
</style>
