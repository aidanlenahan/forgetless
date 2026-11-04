<script lang="ts">
	// Accessible modal built on <dialog> (native focus trap, inert background, Escape).
	// Renders as a bottom sheet on narrow screens. Enter and exit are animated (exit is shorter);
	// the top-placed variant (quick capture, opened from the keyboard many times a day) opens instantly.
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
	let closing = $state(false);
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	const titleId = `dlg-${Math.random().toString(36).slice(2, 9)}`;
	const EXIT_MS = 140;

	function reducedMotion() {
		return matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	$effect(() => {
		const d = dialog;
		if (!d) return;
		if (open) {
			clearTimeout(closeTimer);
			closing = false;
			if (!d.open) {
				d.showModal();
				queueMicrotask(() => {
					const el = d.querySelector<HTMLElement>('[data-autofocus]');
					if (el) el.focus();
				});
			}
		} else if (d.open && !closing) {
			if (reducedMotion() || document.hidden) {
				d.close();
				return;
			}
			closing = true;
			closeTimer = setTimeout(() => {
				closing = false;
				d.close();
			}, EXIT_MS);
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
	class:closing
	aria-labelledby={titleId}
	oncancel={onCancel}
	onpointerdown={onPointerDown}
	onclick={onClick}
	data-testid={testid}
>
	{#if open || closing}
		<div class="modal-panel">
			<div class="modal-grabber" aria-hidden="true"></div>
			<header class="modal-head" class:sr-only={hideTitle}>
				<h2 id={titleId}>{title}</h2>
				<button type="button" class="btn ghost icon sm modal-close" aria-label="Close" onclick={onclose}>
					<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
						><path
							d="M4 4l8 8M12 4l-8 8"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
						/></svg
					>
				</button>
			</header>
			<div class="modal-body">
				{@render children()}
			</div>
			{#if footer}
				<footer class="modal-foot">{@render footer()}</footer>
			{/if}
		</div>
	{/if}
</dialog>
