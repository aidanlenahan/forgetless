<script lang="ts">
	import AuthPage from '#lib/components/AuthPage.svelte';
	import { session } from '#lib/client/session.svelte.ts';
</script>

<svelte:head><title>Sign up · Forgetless</title></svelte:head>
{#if session.config.allowSignup}
	<AuthPage mode="signup" />
{:else}
	<main class="closed">
		<div class="card pad stack">
			<h1>Sign-ups are closed</h1>
			<p class="muted">This instance isn't accepting new accounts.</p>
			<a class="btn primary" href="/login">Back to sign in</a>
		</div>
	</main>
{/if}

<style>
	.closed {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: var(--s-4);
	}
	.closed .card {
		max-width: 400px;
	}
</style>
