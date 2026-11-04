<script lang="ts">
	import { page } from '$app/state';
	import { authClient, authErrorMessage } from '#lib/client/auth-client.ts';
	import Logo from '#lib/components/Logo.svelte';

	const token = $derived(page.url.searchParams.get('token'));
	let email = $state('');
	let password = $state('');
	let busy = $state(false);
	let msg = $state('');
	let error = $state('');

	async function request(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			const res = await authClient.requestPasswordReset({
				email: email.trim(),
				redirectTo: `${location.origin}/reset-password`
			});
			if (res.error) error = authErrorMessage(res.error);
			else msg = 'If that email has an account, we sent it a reset link.';
		} catch {
			error = "Couldn't reach the server. Try again in a moment.";
		} finally {
			busy = false;
		}
	}
	async function reset(e: SubmitEvent) {
		e.preventDefault();
		if (!token) return;
		busy = true;
		error = '';
		try {
			const res = await authClient.resetPassword({ newPassword: password, token });
			if (res.error) error = authErrorMessage(res.error);
			else msg = 'Your password is updated. You can sign in now.';
		} catch {
			error = "Couldn't reach the server. Try again in a moment.";
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Reset password · Forgetless</title></svelte:head>
<main class="wrap">
	<a class="brand" href="/" aria-label="Forgetless home"><Logo size={26} /></a>
	<div class="card pad stack box">
		<h1>Reset password</h1>
		{#if msg}
			<p>{msg}</p>
			<a class="btn primary" href="/login">Back to sign in</a>
		{:else if token}
			<form class="stack" onsubmit={reset}>
				<div class="field">
					<label for="rp-pass">New password</label>
					<input
						id="rp-pass"
						class="input"
						type="password"
						bind:value={password}
						minlength="8"
						required
						autocomplete="new-password"
					/>
				</div>
				{#if error}<p class="err" role="alert">{error}</p>{/if}
				<button class="btn primary lg" disabled={busy}>Set password</button>
			</form>
		{:else}
			<form class="stack" onsubmit={request}>
				<p class="muted small">Enter your email and we'll send you a link to choose a new password.</p>
				<div class="field">
					<label for="rp-email">Email</label>
					<input
						id="rp-email"
						class="input"
						type="email"
						bind:value={email}
						required
						autocomplete="email"
					/>
				</div>
				{#if error}<p class="err" role="alert">{error}</p>{/if}
				<button class="btn primary lg" disabled={busy}>Send reset link</button>
				<a class="small" href="/login">Back to sign in</a>
			</form>
		{/if}
	</div>
</main>

<style>
	.wrap {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--s-5);
		padding: var(--s-4);
	}
	.brand {
		color: var(--text);
		text-decoration: none;
	}
	.box {
		width: 100%;
		max-width: 400px;
	}
	.err {
		color: var(--danger);
		font-size: var(--fs-sm);
		background: var(--danger-soft);
		padding: var(--s-2) var(--s-3);
		border-radius: var(--r);
	}
</style>
