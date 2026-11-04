<script lang="ts">
	import { toasts, dismissToast } from '#lib/client/ui.svelte.ts';
</script>

<div class="toasts" aria-live="polite" aria-atomic="false">
	{#each toasts as t (t.id)}
		<div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'}>
			<span class="grow">{t.message}</span>
			{#if t.action}<a href={t.action.href} onclick={() => dismissToast(t.id)}>{t.action.label}</a
				>{/if}
			<button type="button" class="x" aria-label="Dismiss" onclick={() => dismissToast(t.id)}
				>×</button
			>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		left: 50%;
		bottom: calc(88px + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		z-index: 60;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		width: min(440px, calc(100vw - 32px));
		pointer-events: none;
	}
	@media (min-width: 900px) {
		.toasts {
			bottom: var(--s-5);
		}
	}
	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: var(--s-3) var(--s-4);
		border-radius: var(--r-lg);
		background: var(--text);
		color: var(--bg);
		box-shadow: var(--shadow-lg);
		font-size: var(--fs-sm);
		animation: up 0.2s var(--ease);
	}
	.toast.error {
		background: var(--danger);
		color: #fff;
	}
	.toast a {
		color: inherit;
		font-weight: 650;
		text-decoration: underline;
	}
	.x {
		border: none;
		background: none;
		color: inherit;
		opacity: 0.6;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		padding: 0 2px;
	}
	@keyframes up {
		from {
			transform: translateY(8px);
			opacity: 0;
		}
	}
</style>
