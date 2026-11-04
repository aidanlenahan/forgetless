<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { APP_NAME } from '#lib/shared/config.ts';
	import Logo from './Logo.svelte';
	import Poster from './Poster.svelte';
	import Icon from './Icon.svelte';
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
	/** Which control the current error belongs to, so it shows next to it. */
	let errorAt = $state<'demo' | 'form'>('form');

	const cfg = $derived(session.config);
	const next = $derived.by(() => {
		const n = page.url.searchParams.get('next');
		return n && n.startsWith('/') && !n.startsWith('//') ? n : '/';
	});
	const oauthError = $derived(page.url.searchParams.get('error'));

	// The landing's illustration: a page of a list, set with the app's own components.
	const SAMPLE = [
		{ title: 'Past Lives', icon: '🎬', meta: '2023 · Movie', by: 'Sam', tint: 0, status: null },
		{ title: 'Piranesi', icon: '📚', meta: 'Read', by: 'Mom', tint: 1, status: 'In progress' },
		{ title: 'Thai Diner', icon: '🍜', meta: 'Eat', by: 'Jo', tint: 2, status: null },
		{ title: 'Kyoto Moss Garden', icon: '📍', meta: 'Visit', by: 'Priya', tint: 3, status: null }
	];

	async function enter() {
		await initSession();
		if (session.status === 'signedIn') await goto(next, { replace: true });
		else
			error =
				"You're signed in, but this browser didn't keep the session. Check that cookies are allowed.";
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		errorAt = 'form';
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
				? "Couldn't reach the server. Try again in a moment."
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
			error = "Couldn't reach the server. Try again in a moment.";
		} finally {
			busy = null;
		}
	}

	async function demo() {
		errorAt = 'demo';
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
						? 'Your network has opened too many demo accounts. Try again in an hour.'
						: `The demo isn't available right now (${r.status}).`);
				return;
			}
			location.assign('/');
		} catch {
			error = "Couldn't reach the server. Try again in a moment.";
		} finally {
			busy = null;
		}
	}
</script>

{#snippet signin()}
	{#if oauthError}<p class="err" role="alert">
			Sign-in didn't go through ({oauthError}). Try again.
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
						<a class="xs" href="/reset-password">Forgot it?</a>
					{:else}
						<span
							class="xs faint"
							title="This server can't send reset emails. An admin can reset your password from the command line."
							>Forgot it? Ask your admin.</span
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
				aria-describedby={mode === 'signup' ? 'pw-hint' : undefined}
				data-testid="auth-password"
			/>
			{#if mode === 'signup'}<span class="hint" id="pw-hint">At least 8 characters.</span>{/if}
		</div>
		{#if error && (errorAt === 'form' || !hero)}<p class="err" role="alert">{error}</p>{/if}
		<button
			type="submit"
			class="btn lg block"
			class:primary={!cfg.demoEnabled || mode === 'signup' || !hero}
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
			Have an account? <a href="/login">Sign in</a>
		{/if}
	</p>
{/snippet}

{#if hero}
	<main class="landing">
		<header class="bar">
			<Logo size={24} />
			<a class="btn ghost sm jump" href="#signin">Sign in</a>
		</header>

		<section class="pitch" aria-labelledby="pitch-h">
			<h1 id="pitch-h">Keep track of what people tell you to try.</h1>
			<p class="lede">
				Save a show, a book, a restaurant or a place in a few seconds, along with who recommended it
				and why. When you have a free evening, {APP_NAME} picks one for you.
			</p>
			{#if cfg.demoEnabled}
				<div class="cta">
					<button
						type="button"
						class="btn primary lg"
						onclick={demo}
						disabled={!!busy}
						data-testid="demo-button"
					>
						{#if busy === 'demo'}<span class="spinner"></span>{/if}Try the demo
					</button>
					<p class="hint">No sign-up. You get sample lists, deleted after 24 hours.</p>
				</div>
				{#if error && errorAt === 'demo'}<p class="err" role="alert">{error}</p>{/if}
			{/if}
			<ul class="facts">
				<li><strong>Works offline.</strong> Save on the subway; it syncs later.</li>
				<li><strong>Your data.</strong> Export everything as JSON or CSV, or host it yourself.</li>
			</ul>
		</section>

		<figure class="sample" aria-hidden="true">
			<div class="sheet">
				<div class="sheet-head">
					<span class="sheet-title">All</span>
					<span class="sheet-count">4 items</span>
				</div>
				{#each SAMPLE as it (it.title)}
					<div
						class="srow"
						style="--tint-bg: var(--cat-{it.tint}-bg); --tint-ink: var(--cat-{it.tint}-ink);"
					>
						<Poster icon={it.icon} title={it.title} width={40} />
						<span class="sbody">
							<span class="st">{it.title}</span>
							<span class="sm">{it.meta} <span class="dotsep">·</span> <em>from {it.by}</em></span>
						</span>
						{#if it.status}<span class="pill in_progress">{it.status}</span>{/if}
					</div>
				{/each}
			</div>
			<div class="saved">
				<span class="tick"><Icon name="check" size={14} stroke={2.2} /></span>
				<span><strong>Saved to Eat</strong> · from Jo, “get the khao soi”</span>
			</div>
		</figure>

		<section class="signin card" id="signin" aria-labelledby="signin-h">
			<h2 id="signin-h">Sign in</h2>
			{@render signin()}
		</section>
	</main>
{:else}
	<main class="auth">
		<a class="brand" href="/" aria-label="{APP_NAME} home"><Logo size={26} /></a>
		<section class="card box" aria-labelledby="auth-h">
			<h1 id="auth-h">{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
			{#if cfg.demoEnabled && mode === 'login'}
				<button
					type="button"
					class="btn lg block"
					onclick={demo}
					disabled={!!busy}
					data-testid="demo-button"
				>
					{#if busy === 'demo'}<span class="spinner"></span>{/if}Try the demo instead
				</button>
				<div class="or"><span>or sign in</span></div>
			{/if}
			{@render signin()}
		</section>
	</main>
{/if}

<style>
	/* ---------- Landing (signed out, "/") ---------- */
	.landing {
		min-height: 100dvh;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'bar' 'pitch' 'sample' 'signin';
		gap: var(--s-6);
		max-width: 1120px;
		margin: 0 auto;
		padding: var(--s-4) var(--s-4) var(--s-7);
	}
	.bar {
		grid-area: bar;
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 48px;
	}
	.pitch {
		grid-area: pitch;
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		align-items: flex-start;
	}
	h1 {
		font-size: clamp(2.25rem, 7.5vw, 3.5rem);
		font-weight: 520;
		line-height: 1.02;
		letter-spacing: -0.03em;
		max-width: 18ch;
	}
	.lede {
		font-size: 1.0625rem;
		line-height: 1.55;
		color: var(--text-2);
		max-width: 46ch;
	}
	.cta {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		margin-top: var(--s-2);
	}
	.cta .btn {
		min-width: 220px;
	}
	.facts {
		list-style: none;
		margin: var(--s-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		font-size: var(--fs-sm);
		color: var(--text-2);
		max-width: 46ch;
	}
	.facts strong {
		color: var(--text);
	}

	.sample {
		grid-area: sample;
		position: relative;
		margin: 0;
		padding-bottom: var(--s-6);
	}
	.sheet {
		padding: var(--s-3) var(--s-3) var(--s-2);
		border-radius: var(--r-lg);
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: var(--shadow);
		transform: rotate(-1deg);
	}
	.sheet-head {
		display: flex;
		align-items: baseline;
		gap: var(--s-2);
		padding: var(--s-1) var(--s-2) var(--s-2);
	}
	.sheet-title {
		font-family: var(--font-serif);
		font-size: var(--fs-lg);
		font-weight: 560;
	}
	.sheet-count {
		font-size: var(--fs-xs);
		color: var(--text-2);
	}
	.srow {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: var(--s-2);
		border-top: 1px solid var(--border);
	}
	.sbody {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.st {
		font-family: var(--font-serif);
		font-size: var(--fs-md);
		font-weight: 560;
		line-height: 1.25;
	}
	.sm {
		font-size: var(--fs-xs);
		color: var(--text-2);
	}
	.sm em {
		font-family: var(--font-serif);
		font-size: 0.875rem;
		color: var(--text);
	}
	.dotsep {
		color: var(--text-3);
	}
	.saved {
		position: absolute;
		right: var(--s-2);
		bottom: 0;
		display: flex;
		align-items: center;
		gap: var(--s-2);
		max-width: calc(100% - 24px);
		padding: var(--s-2) var(--s-4) var(--s-2) var(--s-2);
		border-radius: var(--r-lg);
		background: var(--ink-inverse);
		color: var(--on-ink-inverse);
		font-size: var(--fs-sm);
		box-shadow: var(--shadow-lg);
		transform: rotate(1.5deg);
	}
	.tick {
		display: grid;
		place-items: center;
		flex: none;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 12px;
		font-weight: 700;
	}

	.signin {
		grid-area: signin;
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		width: 100%;
		max-width: 420px;
		padding: var(--s-5);
		scroll-margin-top: var(--s-4);
	}
	.signin h2 {
		font-size: var(--fs-lg);
	}

	@media (min-width: 900px) {
		.landing {
			grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
			grid-template-rows: auto 1fr auto;
			grid-template-areas:
				'bar bar'
				'pitch sample'
				'signin sample';
			column-gap: var(--s-8);
			row-gap: var(--s-6);
			padding: var(--s-5) var(--s-6) var(--s-7);
			align-content: start;
		}
		.jump {
			display: none;
		}
		.pitch {
			padding-top: var(--s-6);
		}
		.sample {
			align-self: center;
			padding: var(--s-6) var(--s-4) var(--s-7);
		}
		.sheet {
			padding: var(--s-4) var(--s-4) var(--s-3);
		}
		.saved {
			right: -8px;
			bottom: var(--s-4);
		}
	}

	/* ---------- Plain auth pages (/login, /signup) ---------- */
	.auth {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--s-5);
		padding: var(--s-6) var(--s-4);
	}
	.brand {
		color: var(--text);
		text-decoration: none;
	}
	.box {
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding: var(--s-5);
	}
	.box h1 {
		font-size: var(--fs-xl);
		max-width: none;
	}

	/* ---------- Shared ---------- */
	.or {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		color: var(--text-2);
		font-size: var(--fs-xs);
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
