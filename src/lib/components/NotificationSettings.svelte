<script lang="ts">
	// Settings → Notifications (Phase 3): channels, digest, resurface, quiet hours, cap, test, preview.
	import { onMount } from 'svelte';
	import { session } from '#lib/client/session.svelte.ts';
	import { store } from '#lib/client/store.svelte.ts';
	import { syncStatus } from '#lib/client/sync.ts';
	import { toast } from '#lib/client/ui.svelte.ts';
	import {
		currentSubscription,
		deviceLabel,
		isIos,
		pushSupport,
		subscribePush,
		unsubscribePush,
		type PushSupport
	} from '#lib/client/push.ts';
	import {
		DEFAULT_PREFS,
		type NotificationPrefs,
		type PrefsResponse,
		type PreviewResponse
	} from '#lib/shared/notifications.ts';

	const isGuest = $derived(!!session.user?.isGuest);

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let data = $state<PrefsResponse | null>(null);
	let form = $state<NotificationPrefs>({ ...DEFAULT_PREFS });
	let savedJson = $state('');
	let saving = $state(false);
	let testing = $state(false);
	let pushBusy = $state(false);
	let support = $state<PushSupport>({ ok: false, reason: 'unsupported' });
	let thisEndpoint = $state<string | null>(null);

	const dirty = $derived(JSON.stringify(form) !== savedJson);
	const browserTz = (() => {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
		} catch {
			return 'UTC';
		}
	})();
	const zones: string[] = (() => {
		try {
			return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
				'timeZone'
			);
		} catch {
			return [];
		}
	})();
	const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	const hourLabel = (h: number) =>
		new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	const ordinal = (n: number) =>
		`${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

	const emailAvailable = $derived(!!data?.channels.email && !!data?.email);
	const thisDeviceSubscribed = $derived(
		!!thisEndpoint && !!data?.subscriptions.some((s) => s.endpoint === thisEndpoint)
	);
	const anyChannel = $derived(
		(form.emailEnabled && emailAvailable) || (form.pushEnabled && !!data?.subscriptions.length)
	);

	function apply(r: PrefsResponse) {
		data = r;
		const p = { ...r.prefs };
		if (!r.saved) p.timezone = browserTz;
		form = p;
		savedJson = JSON.stringify(r.saved ? r.prefs : { ...r.prefs, timezone: '' });
	}

	async function load() {
		loading = true;
		loadError = null;
		try {
			const r = await fetch('/api/notifications/prefs');
			if (!r.ok) throw new Error(await message(r, 'Could not load notification settings'));
			apply((await r.json()) as PrefsResponse);
		} catch (e) {
			loadError = navigator.onLine
				? e instanceof Error
					? e.message
					: 'Could not load notification settings'
				: 'Notification settings need a connection.';
		} finally {
			loading = false;
		}
	}

	async function message(r: Response, fallback: string) {
		const b = (await r.json().catch(() => null)) as { message?: string } | null;
		return b?.message || `${fallback} (${r.status})`;
	}

	onMount(() => {
		if (isGuest) {
			loading = false;
			return;
		}
		support = pushSupport();
		void currentSubscription().then((s) => (thisEndpoint = s?.endpoint ?? null));
		void load();
	});

	async function save(e?: SubmitEvent) {
		e?.preventDefault();
		saving = true;
		try {
			const r = await fetch('/api/notifications/prefs', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(form)
			});
			if (!r.ok) throw new Error(await message(r, 'Could not save'));
			apply((await r.json()) as PrefsResponse);
			toast('Notification settings saved', { kind: 'success' });
			if (previewOpen) void loadPreview();
		} catch (err) {
			toast(err instanceof Error ? err.message : 'Could not save', { kind: 'error' });
		} finally {
			saving = false;
		}
	}

	async function togglePush(on: boolean) {
		pushBusy = true;
		try {
			if (on) {
				const sub = await subscribePush();
				thisEndpoint = sub.endpoint;
				form.pushEnabled = true;
			} else {
				await unsubscribePush();
				thisEndpoint = null;
			}
			const r = await fetch('/api/notifications/prefs', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					pushEnabled: on ? true : form.pushEnabled,
					// first save: also store the detected time zone
					...(data?.saved ? {} : { timezone: form.timezone })
				})
			});
			if (r.ok) {
				const next = (await r.json()) as PrefsResponse;
				// keep other unsaved edits, but record what's now saved
				savedJson = data?.saved
					? JSON.stringify({
							...(JSON.parse(savedJson) as NotificationPrefs),
							pushEnabled: next.prefs.pushEnabled
						})
					: JSON.stringify(next.prefs);
				data = next;
			}
		} catch (err) {
			toast(err instanceof Error ? err.message : 'Push setup failed', { kind: 'error' });
			support = pushSupport();
		} finally {
			pushBusy = false;
		}
	}

	async function removeDevice(endpoint: string) {
		await unsubscribePush(endpoint);
		if (endpoint === thisEndpoint) thisEndpoint = null;
		await load();
	}

	async function sendTest() {
		testing = true;
		try {
			const r = await fetch('/api/notifications/test', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ channel: 'all' })
			});
			const b = (await r.json().catch(() => null)) as {
				status?: string;
				channels?: string[];
				errors?: string[];
				message?: string;
			} | null;
			if (!r.ok)
				throw new Error(b?.message || b?.errors?.join('; ') || `Test failed (${r.status})`);
			const via = (b?.channels ?? []).map((c) => (c === 'email' ? 'email' : 'push')).join(' and ');
			toast(via ? `Test sent by ${via}.` : 'Nothing was sent.', { kind: 'success' });
		} catch (err) {
			toast(err instanceof Error ? err.message : 'Test failed', { kind: 'error' });
		} finally {
			testing = false;
		}
	}

	// ----- category scope -----
	const allLists = $derived(form.digestCategoryIds == null);
	function setAllLists(on: boolean) {
		form.digestCategoryIds = on ? null : store.categories.map((c) => c.id);
	}
	function toggleList(id: string, on: boolean) {
		const cur = form.digestCategoryIds ?? store.categories.map((c) => c.id);
		const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
		form.digestCategoryIds = next;
	}

	// ----- quiet hours -----
	const quietOn = $derived(form.quietStart != null && form.quietEnd != null);
	function setQuiet(on: boolean) {
		form.quietStart = on ? '22:00' : null;
		form.quietEnd = on ? '08:00' : null;
	}

	// ----- preview -----
	let previewOpen = $state(false);
	let previewBusy = $state(false);
	let previews = $state<{ digest: PreviewResponse | null; resurface: PreviewResponse | null }>({
		digest: null,
		resurface: null
	});
	async function loadPreview() {
		previewBusy = true;
		try {
			const [d, r] = await Promise.all(
				(['digest', 'resurface'] as const).map((k) =>
					fetch(`/api/notifications/preview?kind=${k}`).then((x) =>
						x.ok ? (x.json() as Promise<PreviewResponse>) : null
					)
				)
			);
			previews = { digest: d, resurface: r };
		} catch {
			previews = { digest: null, resurface: null };
		} finally {
			previewBusy = false;
		}
	}
	const fmtWhen = (ms: number | null) =>
		ms
			? new Date(ms).toLocaleString(undefined, {
					weekday: 'short',
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit'
				})
			: null;
	const ageText = (d: number) =>
		d < 1 ? 'today' : d < 60 ? `${d} day${d === 1 ? '' : 's'}` : `${Math.floor(d / 30.44)} months`;
</script>

<section class="card pad" id="notifications" aria-labelledby="notif-h" data-testid="notifications">
	<h2 id="notif-h">Notifications</h2>
	<p class="muted small sub">
		A digest of things you saved, and an occasional nudge about old ones. Nothing is sent until you
		turn it on here.
	</p>

	{#if isGuest}
		<p class="notice quiet" data-testid="notif-guest">
			Demo accounts don't get notifications. Create an account to get digests and reminders.
		</p>
	{:else if loading}
		<div class="row muted small"><span class="spinner"></span> Loading…</div>
	{:else if loadError || !data}
		<div class="row wrap">
			<p class="muted small">{loadError}</p>
			<button type="button" class="btn sm" onclick={load} disabled={!$syncStatus.online}
				>Try again</button
			>
		</div>
	{:else}
		<form class="nform" onsubmit={save}>
			<div class="group">
				<h3>Send to</h3>
				<div class="chan">
					<label class="check">
						<input
							type="checkbox"
							bind:checked={form.emailEnabled}
							disabled={!emailAvailable}
							data-testid="notif-email"
						/>
						Email
						{#if data.email}<span class="faint xs">{data.email}</span>{/if}
					</label>
					{#if !data.channels.email}
						<p class="hint">
							Email isn't set up on this server. The admin sets <code>SMTP_URL</code> to turn it on.
						</p>
					{:else if !data.email}
						<p class="hint">Your account has no email address that can receive mail.</p>
					{/if}
				</div>
				<div class="chan">
					<label class="check">
						<input
							type="checkbox"
							checked={form.pushEnabled && thisDeviceSubscribed}
							disabled={pushBusy || !support.ok}
							onchange={(e) => togglePush(e.currentTarget.checked)}
							data-testid="notif-push"
						/>
						Push notifications on this device
						{#if pushBusy}<span class="spinner"></span>{/if}
					</label>
					{#if !support.ok}
						<p class="hint" data-testid="push-support">
							{#if support.reason === 'ios-not-installed'}
								On iPhone and iPad, push works only in the installed app (iOS 16.4 or later). In
								Safari, tap Share → Add to Home Screen, open Forgetless from there, and turn this
								on.
							{:else if support.reason === 'denied'}
								Notifications are blocked for this site. Allow them in your browser's site settings,
								then reload.
							{:else if isIos()}
								This version of iOS doesn't support web push. It needs iOS 16.4 or later.
							{:else}
								This browser doesn't support push notifications.
							{/if}
						</p>
					{/if}
					{#if data.subscriptions.length}
						<ul class="devices">
							{#each data.subscriptions as s (s.id)}
								<li class="row">
									<span class="grow small"
										>{deviceLabel(s.userAgent)}
										{#if s.endpoint === thisEndpoint}<span class="pill">This device</span>{/if}
										<span class="xs faint">
											· added {new Date(s.createdAt).toLocaleDateString()}</span
										></span
									>
									<button
										type="button"
										class="btn ghost sm danger"
										onclick={() => removeDevice(s.endpoint)}>Remove</button
									>
								</li>
							{/each}
						</ul>
						{#if !form.pushEnabled}
							<p class="hint">Push is off. Devices stay registered until you remove them.</p>
						{/if}
					{/if}
				</div>
			</div>

			<div class="group">
				<h3>Digest</h3>
				<div class="grid">
					<label class="field">
						<span class="label">How often</span>
						<select class="select sm" bind:value={form.digestFrequency} data-testid="digest-freq">
							<option value="off">Off</option>
							<option value="weekly">Weekly</option>
							<option value="monthly">Monthly</option>
						</select>
					</label>
					{#if form.digestFrequency === 'weekly'}
						<label class="field">
							<span class="label">Day</span>
							<select class="select sm" bind:value={form.digestDayOfWeek} data-testid="digest-day">
								{#each DAYS as d, i (d)}<option value={i}>{d}</option>{/each}
							</select>
						</label>
					{:else if form.digestFrequency === 'monthly'}
						<label class="field">
							<span class="label">Day of the month</span>
							<select class="select sm" bind:value={form.digestDayOfMonth}>
								{#each Array.from({ length: 31 }, (_, i) => i + 1) as d (d)}<option value={d}
										>{ordinal(d)}{d > 28 ? ' (or last day)' : ''}</option
									>{/each}
							</select>
						</label>
					{/if}
					<label class="field">
						<span class="label">Time</span>
						<select class="select sm" bind:value={form.digestHour} data-testid="digest-hour">
							{#each Array.from({ length: 24 }, (_, i) => i) as h (h)}<option value={h}
									>{hourLabel(h)}</option
								>{/each}
						</select>
					</label>
					<label class="field">
						<span class="label">Items per list</span>
						<select class="select sm" bind:value={form.digestItemsPerCategory}>
							{#each Array.from({ length: 10 }, (_, i) => i + 1) as n (n)}<option value={n}
									>{n}</option
								>{/each}
						</select>
					</label>
				</div>
				<fieldset class="scope">
					<legend class="label">Lists to include (digest and reminders)</legend>
					<label class="check">
						<input
							type="checkbox"
							checked={allLists}
							onchange={(e) => setAllLists(e.currentTarget.checked)}
						/>
						All lists
					</label>
					{#if !allLists}
						<div class="row wrap lists">
							{#each store.categories as c (c.id)}
								<label class="check">
									<input
										type="checkbox"
										checked={form.digestCategoryIds?.includes(c.id)}
										onchange={(e) => toggleList(c.id, e.currentTarget.checked)}
									/>
									<span aria-hidden="true">{c.icon}</span>
									{c.name}
								</label>
							{/each}
						</div>
					{/if}
				</fieldset>
				<p class="hint">
					Picks the things that have waited longest on each list. Anything in a digest stays out of
					the next one for 30 days.
				</p>
			</div>

			<div class="group">
				<h3>Old items</h3>
				<div class="row wrap">
					<label class="check">
						<input
							type="checkbox"
							bind:checked={form.resurfaceEnabled}
							data-testid="resurface-enabled"
						/>
						Ask me about things I saved more than
					</label>
					<select
						class="select sm narrow"
						bind:value={form.resurfaceAfterMonths}
						aria-label="Months before asking"
					>
						{#each [1, 2, 3, 6, 9, 12, 18, 24] as m (m)}<option value={m}>{m}</option>{/each}
					</select>
					<span class="small">months ago</span>
				</div>
				<p class="hint">
					At most one reminder a day with up to 3 items, each with Keep, Drop and Snooze 1 month.
				</p>
			</div>

			<div class="group">
				<h3>Limits</h3>
				<div class="row wrap quiet">
					<label class="check">
						<input
							type="checkbox"
							checked={quietOn}
							onchange={(e) => setQuiet(e.currentTarget.checked)}
						/>
						Quiet hours
					</label>
					{#if quietOn}
						<input
							class="input sm time"
							type="time"
							step="900"
							bind:value={form.quietStart}
							aria-label="Quiet hours start"
						/>
						<span class="small faint">to</span>
						<input
							class="input sm time"
							type="time"
							step="900"
							bind:value={form.quietEnd}
							aria-label="Quiet hours end"
						/>
					{/if}
				</div>
				<div class="grid">
					<label class="field">
						<span class="label">At most per day</span>
						<select class="select sm" bind:value={form.dailyCap}>
							{#each Array.from({ length: 10 }, (_, i) => i + 1) as n (n)}<option value={n}
									>{n} notification{n === 1 ? '' : 's'}</option
								>{/each}
						</select>
					</label>
					<label class="field">
						<span class="label">Time zone</span>
						<input
							class="input sm"
							list="tz-list"
							bind:value={form.timezone}
							autocomplete="off"
							data-testid="notif-tz"
						/>
						<datalist id="tz-list">
							{#each zones as z (z)}<option value={z}></option>{/each}
						</datalist>
						{#if form.timezone !== browserTz}
							<button type="button" class="linkish xs" onclick={() => (form.timezone = browserTz)}
								>Use this device's ({browserTz})</button
							>
						{/if}
					</label>
				</div>
				<p class="hint">
					Anything due during quiet hours waits until they end. Tests ignore quiet hours and the
					limit.
				</p>
			</div>

			<div class="actions row wrap">
				<button
					class="btn primary"
					disabled={saving || !dirty || !$syncStatus.online}
					data-testid="notif-save"
				>
					{#if saving}<span class="spinner"></span>{/if}Save
				</button>
				<button
					type="button"
					class="btn"
					onclick={sendTest}
					disabled={testing ||
						!$syncStatus.online ||
						!(emailAvailable || data.subscriptions.length)}
					data-testid="notif-test"
				>
					{#if testing}<span class="spinner"></span>{/if}Send test
				</button>
				{#if dirty}<span class="xs faint">Unsaved changes</span
					>{:else if !anyChannel && (form.digestFrequency !== 'off' || form.resurfaceEnabled)}
					<span class="xs faint">Turn on email or push, or nothing will be sent.</span>
				{/if}
			</div>
		</form>

		<details
			class="preview"
			bind:open={previewOpen}
			ontoggle={(e) => {
				if (e.currentTarget.open) void loadPreview();
			}}
			data-testid="notif-preview"
		>
			<summary>Preview next digest</summary>
			{#if previewBusy && !previews.digest}
				<div class="row muted small"><span class="spinner"></span> Loading…</div>
			{:else}
				{#each [previews.digest, previews.resurface] as p, i (i)}
					{#if p}
						<div class="pv">
							<h4>{p.kind === 'digest' ? 'Digest' : 'Old-item reminder'}</h4>
							<p class="xs faint">
								{#if p.nextAt}Next: {fmtWhen(p.nextAt)}{:else}{p.kind === 'digest'
										? 'Digest is off.'
										: 'Reminders are off.'}{/if}
								{#if !p.empty}· “{p.subject}”{/if}
							</p>
							{#if p.empty}
								<p class="small muted">
									{p.kind === 'digest'
										? 'Nothing to send right now: no Want items, or all of them were in a recent digest.'
										: `Nothing is older than ${form.resurfaceAfterMonths} months and untouched.`}
								</p>
							{:else}
								<ul class="pitems">
									{#each p.items as it (it.id)}
										<li>
											<a href="/i/{it.id}"
												><span aria-hidden="true">{it.categoryIcon}</span> {it.title}</a
											>
											<span class="xs faint">{it.categoryName} · waiting {ageText(it.ageDays)}</span
											>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				{/each}
				{#if !previews.digest && !previews.resurface}
					<p class="small muted">Couldn't load the preview. Check your connection.</p>
				{/if}
				{#if dirty}<p class="xs faint">Save to preview with your changes.</p>{/if}
			{/if}
		</details>
	{/if}
</section>

<style>
	section h2 {
		margin-bottom: var(--s-1);
	}
	.sub {
		margin-bottom: var(--s-4);
		max-width: 60ch;
	}
	.nform {
		display: flex;
		flex-direction: column;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		padding: var(--s-4) 0;
		border-top: 1px solid var(--border);
	}
	.group:first-child {
		border-top: none;
		padding-top: 0;
	}
	.group h3 {
		font-size: var(--fs);
	}
	.chan {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.chan .hint,
	.devices {
		padding-left: 26px;
	}
	.hint {
		max-width: 60ch;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.92em;
	}
	.devices {
		list-style: none;
		margin: var(--s-1) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
	}
	.devices .pill {
		margin-left: var(--s-1);
	}
	.grid {
		display: grid;
		gap: var(--s-3);
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
	}
	.scope {
		border: none;
		margin: var(--s-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.lists {
		gap: var(--s-1) var(--s-4);
		padding-left: 26px;
	}
	.narrow {
		width: auto;
	}
	.quiet .time {
		width: 9rem;
	}
	.linkish {
		align-self: flex-start;
		border: none;
		background: none;
		padding: 0;
		color: var(--accent-text);
		font: inherit;
		cursor: pointer;
	}
	.actions {
		padding-top: var(--s-4);
		border-top: 1px solid var(--border);
	}
	.preview {
		margin-top: var(--s-4);
		padding: var(--s-3);
		border-radius: var(--r);
		background: var(--surface-2);
	}
	.preview summary {
		cursor: pointer;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.pv {
		margin-top: var(--s-3);
	}
	.pv h4 {
		margin: 0;
		font-family: var(--font-serif);
		font-size: var(--fs-md);
		font-weight: 560;
	}
	.pitems {
		list-style: none;
		margin: var(--s-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
	}
	.pitems li {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--s-2);
		align-items: baseline;
	}
	.pitems a {
		font-family: var(--font-serif);
		color: var(--text);
	}
</style>
