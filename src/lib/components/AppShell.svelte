<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { APP_NAME } from '#lib/shared/config.ts';
	import { store } from '#lib/client/store.svelte.ts';
	import { session } from '#lib/client/session.svelte.ts';
	import { capture, openCapture, isTypingTarget } from '#lib/client/ui.svelte.ts';
	import { syncStatus } from '#lib/client/sync.ts';
	import SyncIndicator from './SyncIndicator.svelte';
	import UserMenu from './UserMenu.svelte';
	import CaptureModal from './CaptureModal.svelte';

	let { children }: { children: Snippet } = $props();

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
		if (capture.open || document.querySelector('dialog[open]')) return;
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
		<a class="brand" href="/"><span class="logo" aria-hidden="true">✦</span>{APP_NAME}</a>
		<button type="button" class="capture-btn" onclick={() => openCapture(currentCategoryId)}>
			<span aria-hidden="true">＋</span> Capture <kbd>N</kbd>
		</button>
		<nav class="cats">
			<a href="/" class="cat" aria-current={isAll ? 'page' : undefined}>
				<span class="ic" aria-hidden="true">✳️</span><span class="grow truncate">All</span><span
					class="n">{totalWant || ''}</span
				>
			</a>
			{#each store.categories as c (c.id)}
				<a
					href="/c/{c.id}"
					class="cat"
					aria-current={currentCategoryId === c.id && routeId === '/c/[id]' ? 'page' : undefined}
				>
					<span class="ic" aria-hidden="true">{c.icon}</span><span class="grow truncate"
						>{c.name}</span
					><span class="n">{store.wantCounts.get(c.id) || ''}</span>
				</a>
			{/each}
		</nav>
		<div class="foot">
			<a href="/settings" class="cat" aria-current={routeId === '/settings' ? 'page' : undefined}>
				<span class="ic" aria-hidden="true">⚙️</span><span class="grow">Settings</span>
			</a>
			<div class="footrow">
				<UserMenu placement="up" />
			</div>
			<SyncIndicator />
		</div>
	</aside>

	<header class="topbar">
		<a class="brand" href="/"><span class="logo" aria-hidden="true">✦</span>{APP_NAME}</a>
		<div class="grow"></div>
		<SyncIndicator compact={!$syncStatus.pending && $syncStatus.online} />
		<UserMenu />
	</header>
	<nav class="chiprow" aria-label="Lists">
		<a href="/" class="chip" aria-current={isAll ? 'page' : undefined}
			>All <span class="count">{totalWant || ''}</span></a
		>
		{#each store.categories as c (c.id)}
			<a
				href="/c/{c.id}"
				class="chip"
				aria-current={currentCategoryId === c.id && routeId === '/c/[id]' ? 'page' : undefined}
				><span aria-hidden="true">{c.icon}</span>{c.name}
				<span class="count">{store.wantCounts.get(c.id) || ''}</span></a
			>
		{/each}
	</nav>

	<main class="content">
		{#if isGuest && !hideGuestBanner}
			<div class="guest" role="note">
				<span class="grow">
					<strong>Demo account</strong> — data is deleted 24h after creation.
					{#if session.config.allowSignup}<a href="/settings#account">Sign up to keep yours</a>{/if}
				</span>
				<button
					type="button"
					class="btn ghost sm"
					onclick={() => (hideGuestBanner = true)}
					aria-label="Dismiss">×</button
				>
			</div>
		{/if}
		{#if session.offlineSession}
			<div class="offline small" role="status">
				Offline — showing your saved data. Changes will sync when you reconnect.
			</div>
		{/if}
		{@render children()}
	</main>

	<button
		type="button"
		class="fab"
		aria-label="Quick capture"
		title="Quick capture (N or /)"
		onclick={() => openCapture(currentCategoryId)}
		data-testid="capture-open"
	>
		<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"
			><path
				d="M12 5v14M5 12h14"
				stroke="currentColor"
				stroke-width="2.25"
				stroke-linecap="round"
			/></svg
		>
	</button>
</div>

<CaptureModal />

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
		background: color-mix(in srgb, var(--bg) 85%, transparent);
		backdrop-filter: saturate(1.4) blur(12px);
		-webkit-backdrop-filter: saturate(1.4) blur(12px);
	}
	.topbar :global(.um .who) {
		display: none;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		font-weight: 700;
		font-size: var(--fs-md);
		letter-spacing: -0.02em;
		color: var(--text);
		text-decoration: none;
	}
	.logo {
		width: 26px;
		height: 26px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 14px;
	}
	.chiprow {
		position: sticky;
		top: var(--topbar-h);
		z-index: 19;
		display: flex;
		gap: var(--s-2);
		overflow-x: auto;
		padding: var(--s-1) var(--s-4) var(--s-3);
		background: color-mix(in srgb, var(--bg) 85%, transparent);
		backdrop-filter: saturate(1.4) blur(12px);
		-webkit-backdrop-filter: saturate(1.4) blur(12px);
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
		padding: var(--s-4) var(--s-4) calc(112px + env(safe-area-inset-bottom));
		max-width: 920px;
		margin: 0 auto;
		min-width: 0;
	}
	.guest,
	.offline {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		padding: var(--s-2) var(--s-3);
		margin-bottom: var(--s-4);
		border-radius: var(--r);
		background: var(--warn-soft);
		color: var(--warn);
		font-size: var(--fs-sm);
	}
	.guest a {
		color: inherit;
		text-decoration: underline;
		font-weight: 600;
	}
	.offline {
		background: var(--surface-2);
		color: var(--text-2);
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
			0 8px 24px color-mix(in srgb, var(--accent) 40%, transparent),
			var(--shadow);
		cursor: pointer;
		transition:
			transform 0.12s var(--ease),
			background 0.12s;
	}
	.fab:hover {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}
	.fab:active {
		transform: scale(0.96);
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
			gap: var(--s-3);
			padding: var(--s-4) var(--s-3);
			border-right: 1px solid var(--border);
			background: var(--surface);
		}
		.sidebar .brand {
			padding: var(--s-1) var(--s-2) var(--s-2);
		}
		.capture-btn {
			display: flex;
			align-items: center;
			gap: var(--s-2);
			padding: var(--s-2) var(--s-3);
			border: 1px solid var(--border);
			border-radius: var(--r);
			background: var(--bg);
			color: var(--text-2);
			font: inherit;
			font-size: var(--fs-sm);
			cursor: pointer;
			text-align: left;
		}
		.capture-btn:hover {
			border-color: var(--border-strong);
			color: var(--text);
		}
		.capture-btn kbd {
			margin-left: auto;
		}
		.cats {
			flex: 1;
			overflow-y: auto;
			display: flex;
			flex-direction: column;
			gap: 1px;
			margin: 0 calc(-1 * var(--s-1));
			padding: 0 var(--s-1);
		}
		.cat {
			display: flex;
			align-items: center;
			gap: var(--s-2);
			padding: 7px var(--s-2);
			border-radius: var(--r-sm);
			color: var(--text-2);
			text-decoration: none;
			font-size: var(--fs-sm);
			font-weight: 500;
		}
		.cat:hover {
			background: var(--surface-2);
			color: var(--text);
			text-decoration: none;
		}
		.cat[aria-current='page'] {
			background: var(--accent-soft);
			color: var(--accent-text);
		}
		.ic {
			width: 22px;
			text-align: center;
			font-size: 16px;
		}
		.n {
			font-size: var(--fs-xs);
			color: var(--text-3);
			font-variant-numeric: tabular-nums;
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
			padding: var(--s-6) var(--s-6) 128px;
		}
		.content > :global(*) {
			max-width: 880px;
			margin-left: auto;
			margin-right: auto;
		}
		.fab {
			right: var(--s-6);
			bottom: var(--s-6);
		}
	}
</style>
