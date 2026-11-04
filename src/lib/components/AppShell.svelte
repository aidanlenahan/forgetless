<script lang="ts">
	import { onMount, type Component, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { store } from '#lib/client/store.svelte.ts';
	import { session } from '#lib/client/session.svelte.ts';
	import { capture, openCapture, isTypingTarget } from '#lib/client/ui.svelte.ts';
	import { syncStatus } from '#lib/client/sync.ts';
	import { tintStyle } from '#lib/client/visual.ts';
	import SyncIndicator from './SyncIndicator.svelte';
	import UserMenu from './UserMenu.svelte';
	import Logo from './Logo.svelte';
	import Icon from './Icon.svelte';

	let { children }: { children: Snippet } = $props();

	// Quick capture is code-split out of the entry chunk: it is fetched when the browser is idle, and
	// on demand if someone opens it first.
	let CaptureModal = $state<Component | null>(null);
	let loadingCapture: Promise<void> | null = null;
	function loadCapture() {
		loadingCapture ??= import('./CaptureModal.svelte').then((m) => {
			CaptureModal = m.default;
		});
		return loadingCapture;
	}
	onMount(() => {
		const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
		if (w.requestIdleCallback) w.requestIdleCallback(() => void loadCapture());
		else setTimeout(() => void loadCapture(), 1200);
	});
	$effect(() => {
		if (capture.open && !CaptureModal) void loadCapture();
	});

	const routeId = $derived(page.route.id);
	const currentCategoryId = $derived.by(() => {
		if (routeId === '/c/[id]') return page.params.id ?? null;
		if (routeId === '/i/[id]') return store.itemById.get(page.params.id ?? '')?.categoryId ?? null;
		return null;
	});
	const totalWant = $derived([...store.wantCounts.values()].reduce((a, b) => a + b, 0));
	const isAll = $derived(routeId === '/');
	const isGuest = $derived(!!session.user?.isGuest);
	let hideGuestBanner = $state(false);

	function onKey(e: KeyboardEvent) {
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
		// A dialog playing its exit animation (class "closing") no longer owns the keyboard.
		if (capture.open || document.querySelector('dialog[open]:not(.closing)')) return;
		if (isTypingTarget(e.target)) return;
		if (e.key === '/' || e.key === 'n' || e.key === 'N') {
			e.preventDefault();
			openCapture(currentCategoryId);
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="shell">
	<aside class="sidebar" aria-label="Lists">
		<a class="brand" href="/" aria-label="Forgetless, all lists"><Logo size={22} /></a>
		<button type="button" class="capture-btn" onclick={() => openCapture(currentCategoryId)}>
			<Icon name="plus" size={17} />
			<span class="grow">Capture</span>
			<kbd>N</kbd>
		</button>
		<nav class="cats" aria-label="Lists">
			<a href="/" class="cat" aria-current={isAll ? 'page' : undefined}>
				<span class="ic all" aria-hidden="true"><Icon name="stack" size={16} /></span><span
					class="grow truncate">All</span
				><span class="n num">{totalWant || ''}</span>
			</a>
			{#each store.categories as c (c.id)}
				<a
					href="/c/{c.id}"
					class="cat"
					style={tintStyle(c)}
					aria-current={currentCategoryId === c.id && routeId === '/c/[id]' ? 'page' : undefined}
				>
					<span class="ic" aria-hidden="true">{c.icon}</span><span class="grow truncate"
						>{c.name}</span
					><span class="n num">{store.wantCounts.get(c.id) || ''}</span>
				</a>
			{/each}
		</nav>
		<div class="foot">
			<a href="/settings" class="cat" aria-current={routeId === '/settings' ? 'page' : undefined}>
				<span class="ic all" aria-hidden="true"><Icon name="settings" size={16} /></span><span
					class="grow">Settings</span
				>
			</a>
			<div class="footrow">
				<UserMenu placement="up" />
			</div>
			<SyncIndicator />
		</div>
	</aside>

	<header class="topbar">
		<a class="brand" href="/" aria-label="Forgetless, all lists"><Logo size={21} /></a>
		<div class="grow"></div>
		<SyncIndicator compact={!$syncStatus.pending && $syncStatus.online} />
		<UserMenu />
	</header>
	<nav class="chiprow" aria-label="Lists">
		<a href="/" class="chip" aria-current={isAll ? 'page' : undefined}
			>All <span class="count num">{totalWant || ''}</span></a
		>
		{#each store.categories as c (c.id)}
			<a
				href="/c/{c.id}"
				class="chip"
				aria-current={currentCategoryId === c.id && routeId === '/c/[id]' ? 'page' : undefined}
				><span aria-hidden="true">{c.icon}</span>{c.name}
				<span class="count num">{store.wantCounts.get(c.id) || ''}</span></a
			>
		{/each}
	</nav>

	<main class="content">
		<div class="page">
			{#if isGuest && !hideGuestBanner}
				<div class="notice banner" role="note">
					<span class="grow">
						<strong>Demo account</strong>: we delete it and its data 24 hours after it was created.
						{#if session.config.allowSignup}<a href="/settings#account">Keep your lists</a>{/if}
					</span>
					<button
						type="button"
						class="btn ghost icon sm dismiss"
						onclick={() => (hideGuestBanner = true)}
						aria-label="Dismiss"><Icon name="close" size={16} /></button
					>
				</div>
			{/if}
			{#if session.offlineSession}
				<div class="notice quiet banner" role="status">
					<Icon name="cloudOff" size={18} />
					<span class="grow"
						>You're offline. Your saved lists are here, and changes sync when you reconnect.</span
					>
				</div>
			{/if}
			{@render children()}
		</div>
	</main>

	<button
		type="button"
		class="fab"
		aria-label="Quick capture"
		title="Quick capture (N or /)"
		onclick={() => openCapture(currentCategoryId)}
		data-testid="capture-open"
	>
		<Icon name="plus" size={26} stroke={2} />
	</button>
</div>

{#if CaptureModal}<CaptureModal />{/if}

<style>
	.shell {
		min-height: 100dvh;
	}
	.sidebar {
		display: none;
	}
	.topbar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: var(--s-2);
		height: var(--topbar-h);
		padding: 0 var(--s-3) 0 var(--s-4);
		padding-top: env(safe-area-inset-top);
		box-sizing: content-box;
		background: var(--bg);
	}
	.topbar :global(.um .who) {
		display: none;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--text);
		text-decoration: none;
	}
	.brand:hover {
		text-decoration: none;
	}
	.chiprow {
		position: sticky;
		top: calc(var(--topbar-h) + env(safe-area-inset-top));
		z-index: 19;
		display: flex;
		gap: var(--s-2);
		overflow-x: auto;
		padding: 0 var(--s-4) var(--s-3);
		background: var(--bg);
		scrollbar-width: none;
		border-bottom: 1px solid var(--border);
	}
	.chiprow::-webkit-scrollbar {
		display: none;
	}
	.chiprow .chip {
		flex: none;
	}
	.content {
		padding: var(--s-5) var(--s-4) calc(112px + env(safe-area-inset-bottom));
		max-width: 920px;
		margin: 0 auto;
		min-width: 0;
	}
	.banner {
		margin-bottom: var(--s-5);
	}
	.banner :global(.icon) {
		flex: none;
	}
	.dismiss {
		color: inherit;
		margin: -6px -8px -6px 0;
	}
	.fab {
		position: fixed;
		right: max(var(--s-4), env(safe-area-inset-right));
		bottom: calc(var(--s-5) + env(safe-area-inset-bottom));
		z-index: 30;
		width: 58px;
		height: 58px;
		border-radius: 50%;
		border: none;
		display: grid;
		place-items: center;
		background: var(--accent);
		color: var(--on-accent);
		box-shadow:
			0 6px 18px color-mix(in srgb, var(--accent) 35%, transparent),
			0 2px 4px rgb(40 20 10 / 0.18);
		cursor: pointer;
		transition:
			transform var(--dur-press) var(--ease-out),
			background-color var(--dur-1) ease;
		touch-action: manipulation;
	}
	@media (hover: hover) {
		.fab:hover {
			background: var(--accent-hover);
		}
	}
	.fab:active {
		transform: scale(0.94);
	}

	@media (min-width: 900px) {
		.topbar,
		.chiprow {
			display: none;
		}
		.sidebar {
			position: fixed;
			inset: 0 auto 0 0;
			width: var(--sidebar-w);
			display: flex;
			flex-direction: column;
			gap: var(--s-4);
			padding: var(--s-5) var(--s-3) var(--s-3);
			border-right: 1px solid var(--border);
			background: var(--bg);
		}
		.sidebar .brand {
			padding: 0 var(--s-2);
			min-height: 32px;
		}
		.capture-btn {
			display: flex;
			align-items: center;
			gap: var(--s-2);
			min-height: 40px;
			padding: 0 var(--s-2) 0 var(--s-3);
			border: 1px solid var(--border-strong);
			border-radius: var(--r);
			background: var(--surface);
			color: var(--text-2);
			font: inherit;
			font-size: var(--fs-sm);
			font-weight: 600;
			cursor: pointer;
			text-align: left;
			transition:
				border-color var(--dur-1) ease,
				color var(--dur-1) ease,
				transform var(--dur-press) var(--ease-out);
		}
		.capture-btn:hover {
			border-color: var(--accent);
			color: var(--text);
		}
		.capture-btn:active {
			transform: scale(0.98);
		}
		.capture-btn :global(.icon) {
			color: var(--accent);
		}
		.cats {
			flex: 1;
			overflow-y: auto;
			display: flex;
			flex-direction: column;
			gap: 2px;
			margin: 0 calc(-1 * var(--s-1));
			padding: 0 var(--s-1);
		}
		.cat {
			display: flex;
			align-items: center;
			gap: var(--s-2);
			min-height: 36px;
			padding: 0 var(--s-2);
			border-radius: var(--r-sm);
			color: var(--text-2);
			text-decoration: none;
			font-size: var(--fs);
			font-weight: 500;
			transition:
				background-color var(--dur-1) ease,
				color var(--dur-1) ease;
		}
		.cat:hover {
			background: var(--surface-hover);
			color: var(--text);
			text-decoration: none;
		}
		.cat[aria-current='page'] {
			background: var(--surface-2);
			color: var(--text);
			font-weight: 650;
		}
		.ic {
			width: 24px;
			height: 24px;
			display: grid;
			place-items: center;
			font-size: 15px;
			border-radius: 6px;
			background: var(--tint-bg, transparent);
		}
		.ic.all {
			background: transparent;
			color: var(--text-2);
		}
		.n {
			font-size: var(--fs-xs);
			color: var(--text-3);
		}
		.foot {
			display: flex;
			flex-direction: column;
			gap: var(--s-1);
			border-top: 1px solid var(--border);
			padding-top: var(--s-2);
		}
		.footrow {
			display: flex;
			align-items: center;
		}
		.content {
			margin-left: var(--sidebar-w);
			max-width: none;
			padding: var(--s-7) var(--s-6) 128px;
		}
		.page {
			max-width: 880px;
			margin: 0 auto;
		}
		.fab {
			right: var(--s-6);
			bottom: var(--s-6);
		}
	}
</style>
