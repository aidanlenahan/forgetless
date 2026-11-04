<script lang="ts">
	import { goto } from '$app/navigation';
	import { session, signOut, pendingCount } from '#lib/client/session.svelte.ts';
	import { confirmDialog } from '#lib/client/ui.svelte.ts';

	interface Props {
		placement?: 'up' | 'down';
	}
	let { placement = 'down' }: Props = $props();
	let open = $state(false);
	let root = $state<HTMLElement>();

	const user = $derived(session.user);
	const initial = $derived((user?.name || user?.email || '?').trim().charAt(0).toUpperCase());

	$effect(() => {
		if (!open) return;
		const onDoc = (e: Event) => {
			if (root && !root.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				open = false;
				root?.querySelector<HTMLElement>('.trigger')?.focus();
			}
		};
		document.addEventListener('pointerdown', onDoc);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onDoc);
			document.removeEventListener('keydown', onKey);
		};
	});

	async function doSignOut() {
		open = false;
		const n = await pendingCount();
		const ok = await confirmDialog({
			title: 'Sign out?',
			message:
				n > 0
					? `${n} change${n === 1 ? ' has' : 's have'} not synced yet and will be lost. This device's local copy will be deleted.`
					: "This device's local copy of your data will be deleted. Everything stays safe on the server.",
			confirmLabel: 'Sign out',
			danger: n > 0
		});
		if (!ok) return;
		await signOut();
		await goto('/', { replace: true });
	}
	function nav(href: string) {
		open = false;
		void goto(href);
	}
</script>

<div class="um {placement}" bind:this={root}>
	<button
		type="button"
		class="trigger"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
		data-testid="user-menu"
		title={user?.email}
	>
		<span class="avatar" aria-hidden="true">{initial}</span>
		<span class="who truncate">{user?.isGuest ? 'Demo account' : user?.name || user?.email}</span>
	</button>
	{#if open}
		<div class="menu" role="menu">
			<div class="head">
				<div class="small truncate">{user?.email}</div>
				{#if user?.isGuest}<div class="xs faint">Guest · deleted after 24h</div>{/if}
			</div>
			<button type="button" role="menuitem" onclick={() => nav('/settings')}>⚙️ Settings</button>
			<button type="button" role="menuitem" onclick={() => nav('/settings#data')}
				>📦 Export / import</button
			>
			<hr />
			<button
				type="button"
				role="menuitem"
				class="danger"
				onclick={doSignOut}
				data-testid="sign-out">Sign out</button
			>
		</div>
	{/if}
</div>

<style>
	.um {
		position: relative;
		min-width: 0;
	}
	.trigger {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		width: 100%;
		padding: var(--s-1);
		border: none;
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-size: var(--fs-sm);
		border-radius: var(--r-pill);
		cursor: pointer;
		min-width: 0;
	}
	.trigger:hover {
		background: var(--surface-2);
	}
	.avatar {
		flex: none;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--accent-soft);
		color: var(--accent-text);
		font-weight: 650;
		font-size: var(--fs-sm);
	}
	.menu {
		position: absolute;
		right: 0;
		z-index: 40;
		min-width: 220px;
		padding: var(--s-1);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-lg);
		animation: menu-in 0.12s var(--ease);
	}
	.down .menu {
		top: calc(100% + 6px);
	}
	.up .menu {
		bottom: calc(100% + 6px);
		left: 0;
		right: auto;
	}
	.head {
		padding: var(--s-2) var(--s-3);
	}
	.menu button {
		display: block;
		width: 100%;
		text-align: left;
		padding: var(--s-2) var(--s-3);
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	.menu button:hover,
	.menu button:focus-visible {
		background: var(--surface-2);
	}
	.menu .danger {
		color: var(--danger);
	}
	hr {
		border: none;
		border-top: 1px solid var(--border);
		margin: var(--s-1) 0;
	}
	@keyframes menu-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
</style>
