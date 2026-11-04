<script lang="ts">
	// Accessible modal built on <dialog> (native focus trap, inert background, Escape).
	// Renders as a bottom sheet on narrow screens.
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		title: string;
		/** Visually hide the title (it stays as the accessible name). */
		hideTitle?: boolean;
		onclose: () => void;
		size?: 'sm' | 'md' | 'lg';
		placement?: 'center' | 'top';
		children: Snippet;
		footer?: Snippet;
		testid?: string;
	}
	let {
		open,
		title,
		hideTitle = false,
		onclose,
		size = 'md',
		placement = 'center',
		children,
		footer,
		testid
	}: Props = $props();

	let dialog = $state<HTMLDialogElement>();
	const titleId = `dlg-${Math.random().toString(36).slice(2, 9)}`;

	$effect(() => {
		const d = dialog;
		if (!d) return;
		if (open && !d.open) {
			d.showModal();
			queueMicrotask(() => {
				const el = d.querySelector<HTMLElement>('[data-autofocus]');
				if (el) el.focus();
			});
		} else if (!open && d.open) {
			d.close();
		}
	});

	function onCancel(e: Event) {
		e.preventDefault();
		onclose();
	}
	let downOnBackdrop = false;
	function onPointerDown(e: PointerEvent) {
		downOnBackdrop = e.target === dialog;
	}
	function onClick(e: MouseEvent) {
		if (e.target === dialog && downOnBackdrop) onclose();
		downOnBackdrop = false;
	}
</script>

<dialog
	bind:this={dialog}
	class="modal {size} {placement}"
	aria-labelledby={titleId}
	oncancel={onCancel}
	onpointerdown={onPointerDown}
	onclick={onClick}
	data-testid={testid}
>
	{#if open}
		<div class="panel">
			<header class:sr-only={hideTitle}>
				<h2 id={titleId}>{title}</h2>
				<button type="button" class="btn ghost icon sm close" aria-label="Close" onclick={onclose}>
					<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
						><path
							d="M4 4l8 8M12 4l-8 8"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
						/></svg
					>
				</button>
			</header>
			<div class="body">
				{@render children()}
			</div>
			{#if footer}
				<footer>{@render footer()}</footer>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	dialog {
		padding: 0;
		border: none;
		background: transparent;
		color: var(--text);
		max-width: 100vw;
		max-height: 100dvh;
		width: 100%;
		margin: auto 0 0 0;
		overflow: visible;
	}
	dialog::backdrop {
		background: rgb(10 10 12 / 0.45);
		backdrop-filter: blur(2px);
	}
	dialog[open] {
		animation: sheet-in 0.22s var(--ease);
	}
	dialog[open]::backdrop {
		animation: fade-in 0.2s ease;
	}
	.panel {
		display: flex;
		flex-direction: column;
		max-height: 92dvh;
		background: var(--surface);
		border-radius: var(--r-xl) var(--r-xl) 0 0;
		box-shadow: var(--shadow-lg);
		padding-bottom: env(safe-area-inset-bottom);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		padding: var(--s-4) var(--s-4) 0;
	}
	header h2 {
		flex: 1;
		font-size: var(--fs-md);
	}
	header.sr-only {
		position: absolute;
	}
	.body {
		padding: var(--s-4);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	footer {
		display: flex;
		gap: var(--s-2);
		justify-content: flex-end;
		padding: var(--s-3) var(--s-4) var(--s-4);
		border-top: 1px solid var(--border);
	}

	@media (min-width: 720px) {
		dialog {
			width: calc(100vw - 48px);
			margin: auto;
		}
		dialog.sm {
			max-width: 420px;
		}
		dialog.md {
			max-width: 560px;
		}
		dialog.lg {
			max-width: 720px;
		}
		dialog.top {
			margin-top: 10vh;
		}
		dialog[open] {
			animation: pop-in 0.18s var(--ease);
		}
		.panel {
			border-radius: var(--r-xl);
			max-height: 84dvh;
			padding-bottom: 0;
		}
		header {
			padding: var(--s-5) var(--s-5) 0;
		}
		.body {
			padding: var(--s-5);
		}
		footer {
			padding: var(--s-4) var(--s-5);
		}
	}

	@keyframes sheet-in {
		from {
			transform: translateY(24px);
			opacity: 0;
		}
	}
	@keyframes pop-in {
		from {
			transform: translateY(-6px) scale(0.98);
			opacity: 0;
		}
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
