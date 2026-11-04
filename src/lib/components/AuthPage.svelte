<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { APP_NAME, APP_TAGLINE } from '#lib/shared/config.ts';
	import { authClient, authErrorMessage } from '#lib/client/auth-client.ts';
	import { initSession, session } from '#lib/client/session.svelte.ts';

	interface Props {
		mode: 'login' | 'signup';
		hero?: boolean;
	}
	let { mode, hero = false }: Props = $props();

	let email = $state('');
	let password = $state('');
	let name = $state('');
	let busy = $state<string | null>(null);
	let error = $state('');

	const cfg = $derived(session.config);
	const next = $derived.by(() => {
		const n = page.url.searchParams.get('next');
		return n && n.startsWith('/') && !n.startsWith('//') ? n : '/';
	});
	const oauthError = $derived(page.url.searchParams.get('error'));

	async function enter() {
		await initSession();
		if (session.status === 'signedIn') await goto(next, { replace: true });
		else error = 'Signed in, but the session could not be loaded. Are cookies enabled?';
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		busy = 'form';
		try {
			const res =
				mode === 'login'
					? await authClient.signIn.email({ email: email.trim(), password })
					: await authClient.signUp.email({
							email: email.trim(),
							password,
							name: name.trim() || email.trim().split('@')[0]
						});
			if (res.error) {
				error = authErrorMessage(res.error);
				return;
			}
			await enter();
		} catch {
			error = navigator.onLine
				? 'Could not reach the server.'
				: "You're offline. Connect to sign in.";
		} finally {
			busy = null;
		}
	}

	async function social(provider: 'google' | 'github') {
		busy = provider;
		error = '';
		try {
			const res = await authClient.signIn.social({
				provider,
				callbackURL: next,
				errorCallbackURL: '/login'
			});
			if (res?.error) error = authErrorMessage(res.error);
		} catch {
			error = 'Could not reach the server.';
		} finally {
			busy = null;
		}
	}

	async function demo() {
		busy = 'demo';
		error = '';
		try {
			const r = await fetch('/api/demo', {
				method: 'POST',
				headers: { accept: 'application/json' }
			});
			if (!r.ok) {
				const msg = await r
					.json()
					.then((b: { message?: string }) => b?.message)
					.catch(() => null);
				error =
					msg ||
					(r.status === 429
						? 'Too many demo accounts from your network. Try again later.'
						: `Demo unavailable (${r.status})`);
				return;
			}
			location.assign('/');
		} catch {
			error = 'Could not reach the server.';
		} finally {
			busy = null;
		}
	}
</script>

<main class="auth" class:hero>
	<div class="brand">
		<div class="logo" aria-hidden="true">✦</div>
		{#if hero}
			<h1>{APP_NAME}</h1>
			<p class="tagline">{APP_TAGLINE}</p>
			<ul class="points">
				<li><span aria-hidden="true">⚡</span> Capture anything in a few seconds, even offline</li>
				<li><span aria-hidden="true">💬</span> Remember who recommended it and why</li>
				<li><span aria-hidden="true">🎲</span> Can't decide? Let it pick for you</li>
			</ul>
		{:else}
			<h1>{mode === 'login' ? `Sign in to ${APP_NAME}` : `Create your ${APP_NAME} account`}</h1>
		{/if}
	</div>

	<div class="card pad box">
		{#if cfg.demoEnabled && mode === 'login'}
			<button
				type="button"
				class="btn primary lg block"
				onclick={demo}
				disabled={!!busy}
				data-testid="demo-button"
			>
				{#if busy === 'demo'}<span class="spinner"></span>{/if}Try the demo
			</button>
			<p class="hint center">No sign-up. A sample account, deleted after 24 hours.</p>
			<div class="or"><span>or {mode === 'login' ? 'sign in' : 'sign up'}</span></div>
		{/if}

		{#if oauthError}<p class="err" role="alert">
				Sign-in failed ({oauthError}). Please try again.
			</p>{/if}

		<form class="stack" onsubmit={submit}>
			{#if mode === 'signup'}
				<div class="field">
					<label for="auth-name">Name</label>
					<input
						id="auth-name"
						class="input"
						bind:value={name}
						autocomplete="name"
						placeholder="Optional"
					/>
				</div>
			{/if}
			<div class="field">
				<label for="auth-email">Email</label>
				<input
					id="auth-email"
					class="input"
					type="email"
					bind:value={email}
					autocomplete="email"
					required
					data-testid="auth-email"
				/>
			</div>
			<div class="field">
				<div class="row">
					<label class="grow" for="auth-password">Password</label>
					{#if mode === 'login'}
						{#if cfg.passwordResetEmail}
							<a class="xs" href="/reset-password">Forgot?</a>
						{:else}
							<span
								class="xs faint"
								title="Password reset email isn't configured on this instance. An admin can reset it from the command line."
								>Forgot? Ask your admin</span
							>
						{/if}
					{/if}
				</div>
				<input
					id="auth-password"
					class="input"
					type="password"
					bind:value={password}
					autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
					minlength={mode === 'signup' ? 8 : undefined}
					required
					data-testid="auth-password"
				/>
				{#if mode === 'signup'}<span class="hint">At least 8 characters.</span>{/if}
			</div>
			{#if error}<p class="err" role="alert">{error}</p>{/if}
			<button
				type="submit"
				class="btn lg block"
				class:primary={!cfg.demoEnabled || mode === 'signup'}
				disabled={!!busy}
				data-testid="auth-submit"
			>
				{#if busy === 'form'}<span class="spinner"></span>{/if}
				{mode === 'login' ? 'Sign in' : 'Create account'}
			</button>
		</form>

		{#if cfg.oauth.google || cfg.oauth.github}
			<div class="or"><span>or</span></div>
			<div class="stack social">
				{#if cfg.oauth.google}
					<button
						type="button"
						class="btn lg block"
						onclick={() => social('google')}
						disabled={!!busy}
					>
						<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"
							><path
								fill="#FFC107"
								d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"
							/><path
								fill="#FF3D00"
								d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
							/><path
								fill="#4CAF50"
								d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
							/><path
								fill="#1976D2"
								d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
							/></svg
						>
						Continue with Google
					</button>
				{/if}
				{#if cfg.oauth.github}
					<button
						type="button"
						class="btn lg block"
						onclick={() => social('github')}
						disabled={!!busy}
					>
						<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"
							><path
								d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"
							/></svg
						>
						Continue with GitHub
					</button>
				{/if}
			</div>
		{/if}

		<p class="switch small muted">
			{#if mode === 'login'}
				{#if cfg.allowSignup}New here? <a href="/signup" data-testid="signup-link"
						>Create an account</a
					>{/if}
			{:else}
				Already have an account? <a href="/login">Sign in</a>
			{/if}
		</p>
	</div>
</main>

<style>
	.auth {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--s-5);
		padding: var(--s-6) var(--s-4);
		background:
			radial-gradient(
				1200px 500px at 50% -10%,
				color-mix(in srgb, var(--accent) 12%, transparent),
				transparent 70%
			),
			var(--bg);
	}
	.brand {
		text-align: center;
		max-width: 520px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--s-3);
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
		box-shadow: var(--shadow);
	}
	.hero h1 {
		font-size: var(--fs-2xl);
		letter-spacing: -0.03em;
	}
	.auth:not(.hero) h1 {
		font-size: var(--fs-lg);
	}
	.tagline {
		font-size: var(--fs-md);
		color: var(--text-2);
		text-wrap: balance;
	}
	.points {
		list-style: none;
		padding: 0;
		margin: var(--s-2) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		color: var(--text-2);
		font-size: var(--fs-sm);
		text-align: left;
	}
	.points span {
		display: inline-block;
		width: 1.6em;
	}
	.box {
		width: 100%;
		max-width: 400px;
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}
	.center {
		text-align: center;
		margin-top: calc(-1 * var(--s-2));
	}
	.or {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		color: var(--text-3);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.or::before,
	.or::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border);
	}
	.err {
		color: var(--danger);
		font-size: var(--fs-sm);
		background: var(--danger-soft);
		padding: var(--s-2) var(--s-3);
		border-radius: var(--r);
	}
	.social {
		gap: var(--s-2);
	}
	.switch {
		text-align: center;
	}
</style>
