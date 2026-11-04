<script lang="ts">
	// The mark: a bookmark ribbon with a folded corner, in the accent colour. Optionally with the wordmark.
	import { APP_NAME } from '#lib/shared/config.ts';

	interface Props {
		size?: number;
		wordmark?: boolean;
	}
	let { size = 22, wordmark = true }: Props = $props();
</script>

<span class="logo" style:--size="{size}px">
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
		<path class="logo-ribbon" d="M6.5 2.5h11a1.5 1.5 0 0 1 1.5 1.5v17.2l-7-4.4-7 4.4V4a1.5 1.5 0 0 1 1.5-1.5Z" />
		<path class="logo-fold" d="M14.5 2.5h3a1.5 1.5 0 0 1 1.5 1.5v3Z" />
	</svg>
	{#if wordmark}<span class="logo-word">{APP_NAME}</span>{/if}
</span>
