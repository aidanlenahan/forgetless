<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { APP_NAME } from '#lib/shared/config.ts';
	import { initSession, session } from '#lib/client/session.svelte.ts';
	import AppShell from '#lib/components/AppShell.svelte';
	import AuthPage from '#lib/components/AuthPage.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import ConfirmHost from '#lib/components/ConfirmHost.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const AUTH_ROUTES = ['/login', '/signup', '/reset-password'];
	const path = $derived(page.url.pathname);
	const isAuthRoute = $derived(AUTH_ROUTES.includes(path));

	onMount(() => {
		void initSession();
	});

	$effect(() => {
		if (session.status === 'signedOut' && !isAuthRoute && path !== '/') {
			void goto(`/login?next=${encodeURIComponent(path + page.url.search)}`, { replace: true });
		} else if (session.status === 'signedIn' && (path === '/login' || path === '/signup')) {
			void goto('/', { replace: true });
		}
	});
</script>

<svelte:head>
	<title>{APP_NAME}</title>
</svelte:head>

{#if session.status === 'loading'}
	<div class="splash" aria-busy="true" aria-label="Loading">
		<span class="logo" aria-hidden="true">✦</span>
	</div>
{:else if session.status === 'signedIn' && !isAuthRoute}
	<AppShell>{@render children()}</AppShell>
{:else if session.status === 'signedOut' && path === '/'}
	<AuthPage mode="login" hero />
{:else if isAuthRoute}
	{@render children()}
{/if}

<Toasts />
<ConfirmHost />

<style>
	.splash {
		min-height: 100dvh;
		display: grid;
		place-items: center;
	}
	.logo {
		width: 48px;
		height: 48px;
		border-radius: 14px;
		display: grid;
		place-items: center;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 24px;
		animation: breathe 1.4s ease-in-out infinite;
	}
	@keyframes breathe {
		50% {
			transform: scale(0.92);
			opacity: 0.7;
		}
	}
</style>
