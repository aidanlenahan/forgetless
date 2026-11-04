<script lang="ts">
	import { syncStatus, syncNow } from '#lib/client/sync.ts';

	interface Props {
		compact?: boolean;
	}
	let { compact = false }: Props = $props();
	const s = $derived($syncStatus);
	const state = $derived(
		!s.online ? 'offline' : s.error ? 'error' : s.syncing || s.pending ? 'syncing' : 'ok'
	);
	const label = $derived(
		!s.online
			? s.pending
				? `Offline · ${s.pending} pending`
				: 'Offline'
			: s.error
				? s.pending
					? `${s.pending} pending · retrying`
					: 'Sync error · retrying'
				: s.syncing
					? 'Syncing…'
					: s.pending
						? `${s.pending} pending`
						: 'Synced'
	);
</script>

<button
	type="button"
	class="sync {state}"
	class:compact
	onclick={() => void syncNow()}
	title={s.error ? `${label}: ${s.error}` : `${label} (click to sync now)`}
	aria-label="Sync status: {label}. Sync now"
	data-testid="sync-indicator"
>
	<span class="dot" aria-hidden="true"></span>
	<span class="text" class:sr-only={compact}>{label}</span>
</button>

<style>
	.sync {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		border: none;
		background: transparent;
		color: var(--text-3);
		font: inherit;
		font-size: var(--fs-xs);
		padding: var(--s-1) var(--s-2);
		border-radius: var(--r-pill);
		cursor: pointer;
	}
	.sync:hover {
		background: var(--surface-2);
		color: var(--text-2);
	}
	.compact {
		padding: var(--s-2);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ok);
		flex: none;
	}
	.syncing .dot {
		background: var(--accent);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.offline .dot {
		background: var(--text-3);
	}
	.error .dot {
		background: var(--warn);
	}
	.offline .text,
	.error .text {
		color: var(--text-2);
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
</style>
