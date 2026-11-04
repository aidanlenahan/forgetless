<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import { toasts, dismissToast } from '#lib/client/ui.svelte.ts';
	import Icon from './Icon.svelte';

	const reduced =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<div class="toasts" aria-live="polite" aria-atomic="false">
	{#each toasts as t (t.id)}
		<div
			class="toast {t.kind}"
			role={t.kind === 'error' ? 'alert' : 'status'}
			in:fly={{ y: reduced ? 0 : 16, duration: reduced ? 160 : 260, easing: cubicOut }}
			out:fade={{ duration: 140 }}
			animate:flip={{ duration: reduced ? 0 : 200 }}
		>
			{#if t.kind === 'success'}<span class="ic ok"><Icon name="check" size={16} stroke={2} /></span
				>{:else if t.kind === 'error'}<span class="ic"><Icon name="alert" size={16} /></span>{/if}
			<span class="grow">{t.message}</span>
			{#if t.action}<a href={t.action.href} onclick={() => dismissToast(t.id)}>{t.action.label}</a
				>{/if}
			<button type="button" class="x" aria-label="Dismiss" onclick={() => dismissToast(t.id)}
				><Icon name="close" size={15} /></button
			>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		left: 50%;
		bottom: calc(96px + env(safe-area-inset-bottom));
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
			left: calc(50% + var(--sidebar-w) / 2);
			bottom: var(--s-6);
		}
	}
	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: var(--s-3);
		min-height: 48px;
		padding: var(--s-2) var(--s-2) var(--s-2) var(--s-4);
		border-radius: var(--r-lg);
		background: var(--ink-inverse);
		color: var(--on-ink-inverse);
		box-shadow: var(--shadow-lg);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.toast.error {
		background: var(--danger);
		color: #fff;
	}
	@media (prefers-color-scheme: dark) {
		.toast.error {
			color: #1d0f0a;
		}
	}
	.ic {
		display: grid;
		place-items: center;
		flex: none;
	}
	.ic.ok {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--on-ink-inverse) 16%, transparent);
	}
	.toast a {
		color: inherit;
		font-weight: 700;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		padding: 8px 4px;
	}
	.x {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: inherit;
		opacity: 0.7;
		cursor: pointer;
	}
	.x:hover {
		opacity: 1;
		background: color-mix(in srgb, currentColor 12%, transparent);
	}
</style>
