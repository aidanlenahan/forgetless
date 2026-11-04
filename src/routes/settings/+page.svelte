<script lang="ts">
	import { goto } from '$app/navigation';
	import { store } from '#lib/client/store.svelte.ts';
	import { session, signOut, pendingCount } from '#lib/client/session.svelte.ts';
	import { saveCategory, deleteCategory, reorderCategories } from '#lib/client/mutations.ts';
	import { localDb } from '#lib/client/db.ts';
	import { syncNow, syncStatus } from '#lib/client/sync.ts';
	import { confirmDialog, toast } from '#lib/client/ui.svelte.ts';
	import IconPicker from '#lib/components/IconPicker.svelte';
	import FieldSchemaEditor from '#lib/components/FieldSchemaEditor.svelte';
	import CategoryCatalogs from '#lib/components/import/CategoryCatalogs.svelte';
	import { catalogIndex, refreshCatalogs } from '#lib/client/catalogs.svelte.ts';
	import Icon from '#lib/components/Icon.svelte';
	import { APP_NAME } from '#lib/shared/config.ts';
	import type { Category, ExportFile } from '#lib/shared/types.ts';

	const user = $derived(session.user);
	const itemCounts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const i of store.items) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1);
		return m;
	});

	// ----- Categories -----
	let newIcon = $state('📌');
	let newName = $state('');
	let expanded = $state<string | null>(null);
	let catalogsOpen = $state<string | null>(null);
	void refreshCatalogs();

	async function addCategory(e: SubmitEvent) {
		e.preventDefault();
		const name = newName.trim();
		if (!name) return;
		const c = await saveCategory({ name, icon: newIcon, sort: store.categories.length });
		newName = '';
		newIcon = '📌';
		toast(`Created ${c.icon} ${c.name}`, {
			kind: 'success',
			action: { label: 'Open', href: `/c/${c.id}` }
		});
	}
	function patch(c: Category, p: Partial<Category>) {
		void saveCategory({ ...c, ...p });
	}
	async function move(i: number, d: -1 | 1) {
		const ids = store.categories.map((c) => c.id);
		const j = i + d;
		if (j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		await reorderCategories(ids);
	}
	async function remove(c: Category) {
		const n = itemCounts.get(c.id) ?? 0;
		const ok = await confirmDialog({
			title: `Delete ${c.icon} ${c.name}?`,
			message: n
				? `Its ${n} item${n === 1 ? '' : 's'} will be deleted too. Consider exporting first.`
				: 'The list is empty, so nothing else goes with it.',
			confirmLabel: 'Delete list',
			danger: true
		});
		if (ok) {
			await deleteCategory(c.id);
			toast(`Deleted ${c.name}`);
		}
	}

	// ----- Data -----
	function download(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}
	const stamp = () => new Date().toISOString().slice(0, 10);
	const fileSlug = (s: string) =>
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'list';
	function filenameFrom(r: Response, fallback: string) {
		const cd = r.headers.get('content-disposition') ?? '';
		const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
		return m ? decodeURIComponent(m[1]) : fallback;
	}

	let exporting = $state(false);
	async function exportJson() {
		exporting = true;
		try {
			await syncNow();
			const r = await fetch('/api/export.json');
			if (!r.ok) throw new Error(String(r.status));
			download(await r.blob(), filenameFrom(r, `${fileSlug(APP_NAME)}-export-${stamp()}.json`));
		} catch {
			// Offline / server unavailable: export this device's copy instead.
			const db = localDb();
			const file: ExportFile = {
				format: 'forgetless-export',
				version: 1,
				exportedAt: Date.now(),
				categories: await db.categories.toArray(),
				items: await db.items.toArray(),
				logEntries: await db.logEntries.toArray(),
				catalogEntries: await db.catalogEntries.toArray()
			};
			download(
				new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
				`${fileSlug(APP_NAME)}-export-${stamp()}-local.json`
			);
			toast("Couldn't reach the server, so you got this device's copy instead.");
		} finally {
			exporting = false;
		}
	}

	let csvCategory = $state('');
	$effect(() => {
		if (!csvCategory || !store.categoryById.has(csvCategory))
			csvCategory = store.categories[0]?.id ?? '';
	});
	async function exportCsv() {
		const c = store.categoryById.get(csvCategory);
		if (!c) return;
		try {
			await syncNow();
			const r = await fetch(`/api/export.csv?categoryId=${encodeURIComponent(c.id)}`);
			if (!r.ok) throw new Error(`Export failed (${r.status})`);
			download(await r.blob(), filenameFrom(r, `${fileSlug(c.name)}-${stamp()}.csv`));
		} catch (e) {
			toast(
				navigator.onLine
					? e instanceof Error
						? e.message
						: 'Export failed'
					: 'CSV export needs a connection.',
				{ kind: 'error' }
			);
		}
	}

	let importFile = $state<FileList | null>(null);
	let importMode = $state<'merge' | 'replace'>('merge');
	let importing = $state(false);
	let fileInput = $state<HTMLInputElement>();
	async function doImport(e: SubmitEvent) {
		e.preventDefault();
		const f = importFile?.[0];
		if (!f) return;
		let text: string;
		let parsed: Partial<ExportFile>;
		try {
			text = await f.text();
			parsed = JSON.parse(text);
		} catch {
			toast("That file isn't valid JSON.", { kind: 'error' });
			return;
		}
		if (parsed?.format !== 'forgetless-export') {
			toast(`That doesn't look like a ${APP_NAME} export.`, { kind: 'error' });
			return;
		}
		const counts = `${parsed.categories?.length ?? 0} lists, ${parsed.items?.length ?? 0} items, ${parsed.logEntries?.length ?? 0} log entries`;
		if (importMode === 'replace') {
			const pending = await pendingCount();
			const ok = await confirmDialog({
				title: 'Replace all your data?',
				message: `This deletes everything in your account and loads the file instead (${counts}).${pending ? ` You'll also lose ${pending} change(s) on this device that haven't synced.` : ''}`,
				confirmLabel: 'Replace everything',
				danger: true
			});
			if (!ok) return;
		}
		importing = true;
		try {
			if (importMode === 'merge') await syncNow();
			const r = await fetch(`/api/import?mode=${importMode}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: text
			});
			if (!r.ok) {
				const msg = await r
					.json()
					.then((b: { message?: string }) => b?.message)
					.catch(() => null);
				throw new Error(msg || `Import failed (${r.status})`);
			}
			const { applied } = (await r.json()) as { applied?: number };
			const db = localDb();
			if (importMode === 'replace') {
				await db.transaction(
					'rw',
					[db.categories, db.items, db.logEntries, db.catalogEntries, db.outbox, db.meta],
					async () => {
						await Promise.all([
							db.categories.clear(),
							db.items.clear(),
							db.logEntries.clear(),
							db.catalogEntries.clear(),
							db.outbox.clear()
						]);
						await db.meta.delete('cursor');
					}
				);
			} else {
				await db.meta.delete('cursor');
			}
			await syncNow();
			toast(`Imported ${applied ?? 'all'} records (${counts}).`, { kind: 'success' });
			importFile = null;
			if (fileInput) fileInput.value = '';
		} catch (err) {
			toast(
				navigator.onLine
					? err instanceof Error
						? err.message
						: 'Import failed'
					: 'Import needs a connection.',
				{ kind: 'error' }
			);
		} finally {
			importing = false;
		}
	}

	async function doSignOut() {
		const n = await pendingCount();
		const ok = await confirmDialog({
			title: 'Sign out?',
			message: n
				? `${n} change(s) haven't synced yet and will be lost. Signing out also clears this device's copy.`
				: "Signing out clears this device's copy. Your lists stay on the server.",
			confirmLabel: 'Sign out',
			danger: n > 0
		});
		if (!ok) return;
		await signOut();
		await goto('/', { replace: true });
	}
	const guestExpires = $derived.by(() => {
		const v = user?.guestExpiresAt;
		if (!v) return null;
		const d = new Date(v);
		return Number.isNaN(d.getTime()) ? null : d;
	});
</script>

<svelte:head><title>Settings · {APP_NAME}</title></svelte:head>

<div class="settings">
	<h1>Settings</h1>

	{#if user?.isGuest}
		<div class="notice guest" role="note">
			<strong>This is a demo account. We delete it 24 hours after it was created.</strong>
			{#if guestExpires}<span>This one goes on {guestExpires.toLocaleString()}.</span>{/if}
			{#if session.config.allowSignup}
				<span
					>To keep your lists, export them below, <button
						type="button"
						class="linkbtn"
						onclick={doSignOut}>sign out</button
					>, <a href="/signup">create an account</a> and import the file.</span
				>
			{/if}
		</div>
	{/if}

	<section class="card pad" id="categories" aria-labelledby="cat-h">
		<h2 id="cat-h">Lists</h2>
		<p class="muted small sub">
			Rename and reorder your lists, change their icons, add fields, or connect a database for
			autocomplete.
		</p>
		<ul class="cats">
			{#each store.categories as c, i (c.id)}
				<li class="cat" data-testid="category-row">
					<div class="crow">
						<IconPicker value={c.icon} onchange={(v) => patch(c, { icon: v })} />
						<input
							class="input name"
							value={c.name}
							aria-label="List name"
							onchange={(e) => {
								const v = e.currentTarget.value.trim();
								if (v) patch(c, { name: v });
								else e.currentTarget.value = c.name;
							}}
						/>
						<span class="n xs faint"
							>{itemCounts.get(c.id) ?? 0}
							{(itemCounts.get(c.id) ?? 0) === 1 ? 'item' : 'items'}</span
						>
						<div class="row tight">
							<button
								type="button"
								class="btn ghost icon sm"
								onclick={() => move(i, -1)}
								disabled={i === 0}
								aria-label="Move {c.name} up"><Icon name="arrowUp" size={16} /></button
							>
							<button
								type="button"
								class="btn ghost icon sm"
								onclick={() => move(i, 1)}
								disabled={i === store.categories.length - 1}
								aria-label="Move {c.name} down"><Icon name="arrowDown" size={16} /></button
							>
						</div>
					</div>
					<div class="crow second">
						<label class="row small">
							<span class="muted">Database</span>
							<select
								class="select sm prov"
								value={c.provider ?? ''}
								onchange={(e) => patch(c, { provider: e.currentTarget.value || null })}
							>
								<option value="">None (custom only)</option>
								<option value="tmdb">TMDB (movies & TV)</option>
							</select>
						</label>
						{#if c.provider === 'tmdb' && !session.config.providers.tmdb}
							<span class="xs faint" title="Set TMDB_API_KEY on the server to enable autocomplete"
								>TMDB isn't configured on this server</span
							>
						{/if}
						<div class="grow"></div>
						<button
							type="button"
							class="btn ghost sm"
							aria-expanded={expanded === c.id}
							onclick={() => (expanded = expanded === c.id ? null : c.id)}
						>
							Fields{c.fieldSchema.length ? ` (${c.fieldSchema.length})` : ''}
							<Icon name={expanded === c.id ? 'chevronUp' : 'chevronDown'} size={14} />
						</button>
						<button
							type="button"
							class="btn ghost sm"
							aria-expanded={catalogsOpen === c.id}
							data-testid="catalogs-toggle"
							onclick={() => (catalogsOpen = catalogsOpen === c.id ? null : c.id)}
						>
							Catalogs{catalogIndex.byCategory[c.id]?.length
								? ` (${catalogIndex.byCategory[c.id].length})`
								: ''}
							<Icon name={catalogsOpen === c.id ? 'chevronUp' : 'chevronDown'} size={14} />
						</button>
						<button type="button" class="btn ghost sm danger" onclick={() => remove(c)}
							>Delete</button
						>
					</div>
					{#if expanded === c.id}
						<div class="fields">
							<FieldSchemaEditor
								fields={c.fieldSchema}
								onchange={(fs) => patch(c, { fieldSchema: fs })}
							/>
						</div>
					{/if}
					{#if catalogsOpen === c.id}
						<div class="fields">
							<CategoryCatalogs category={c} />
						</div>
					{/if}
				</li>
			{:else}
				<li class="muted small">No lists yet. Create one below.</li>
			{/each}
		</ul>
		<form class="crow newcat" onsubmit={addCategory}>
			<IconPicker value={newIcon} onchange={(v) => (newIcon = v)} label="New list icon" />
			<input
				class="input name"
				bind:value={newName}
				placeholder="New list, like Board games"
				aria-label="New list name"
				data-testid="new-category-name"
			/>
			<button class="btn primary" disabled={!newName.trim()}>Add list</button>
		</form>
	</section>

	<section class="card pad" id="data" aria-labelledby="data-h">
		<h2 id="data-h">Your data</h2>
		<p class="muted small sub">
			Export everything whenever you like. Importing an export restores it.
		</p>
		<div class="data">
			<div class="block">
				<h3>Export</h3>
				<div class="row wrap">
					<button
						type="button"
						class="btn"
						onclick={exportJson}
						disabled={exporting}
						data-testid="export-json"
					>
						{#if exporting}<span class="spinner"></span>{:else}<Icon
								name="download"
								size={16}
							/>{/if}Export everything (JSON)
					</button>
				</div>
				<div class="row wrap">
					<select
						class="select sm csvsel"
						bind:value={csvCategory}
						aria-label="List to export as CSV"
					>
						{#each store.categories as c (c.id)}<option value={c.id}>{c.icon} {c.name}</option
							>{/each}
					</select>
					<button type="button" class="btn sm" onclick={exportCsv} disabled={!csvCategory}
						>Export CSV</button
					>
				</div>
			</div>
			<form class="block" onsubmit={doImport}>
				<h3>Import</h3>
				<p class="xs muted">
					From Letterboxd, IMDb or Goodreads? <a href="/import" data-testid="settings-import-link"
						>Import from another app</a
					>.
				</p>
				<input
					bind:this={fileInput}
					id="import-file"
					class="file"
					type="file"
					accept="application/json,.json"
					bind:files={importFile}
					aria-label="Export file to import"
				/>
				<fieldset class="modes">
					<legend class="sr-only">Import mode</legend>
					<label class="check"
						><input type="radio" bind:group={importMode} value="merge" /> Merge
						<span class="faint xs">adds and updates, keeps the rest</span></label
					>
					<label class="check"
						><input type="radio" bind:group={importMode} value="replace" /> Replace
						<span class="faint xs">deletes your data first</span></label
					>
				</fieldset>
				<div>
					<button
						class="btn"
						class:danger={importMode === 'replace'}
						disabled={!importFile?.length || importing || !$syncStatus.online}
					>
						{#if importing}<span class="spinner"></span>{/if}Import
					</button>
					{#if !$syncStatus.online}<span class="xs faint">Connect to import.</span>{/if}
				</div>
			</form>
		</div>
	</section>

	<section class="card pad" id="account" aria-labelledby="acct-h">
		<h2 id="acct-h">Account</h2>
		<dl class="acct">
			<div>
				<dt>Email</dt>
				<dd>{user?.email}</dd>
			</div>
			{#if user?.name}<div>
					<dt>Name</dt>
					<dd>{user.name}</dd>
				</div>{/if}
			<div>
				<dt>Type</dt>
				<dd>{user?.isGuest ? 'Demo' : 'Standard'}</dd>
			</div>
		</dl>
		<button type="button" class="btn danger" onclick={doSignOut}
			><Icon name="logout" size={16} /> Sign out</button
		>
	</section>

	<p class="xs faint about">
		{APP_NAME}. Movie and TV data comes from TMDB. This product uses the TMDB API but is not
		endorsed or certified by TMDB.
	</p>
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
	}
	.settings > h1 {
		margin-bottom: var(--s-2);
	}
	@media (min-width: 900px) {
		.settings > h1 {
			font-size: 2.25rem;
		}
	}
	section h2 {
		margin-bottom: var(--s-1);
	}
	.sub {
		margin-bottom: var(--s-4);
		max-width: 60ch;
	}
	.guest {
		flex-direction: column;
		align-items: flex-start;
		gap: var(--s-1);
	}
	.guest a,
	.linkbtn {
		color: inherit;
		text-decoration: underline;
		font-weight: 650;
	}
	.linkbtn {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		cursor: pointer;
	}
	.cats {
		list-style: none;
		margin: 0 0 var(--s-4);
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.cat {
		padding: var(--s-3) 0;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}
	.cat:first-child {
		border-top: none;
		padding-top: 0;
	}
	.crow {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		flex-wrap: wrap;
	}
	.name {
		flex: 1;
		min-width: 120px;
		font-family: var(--font-serif);
		font-size: 1.0625rem;
		font-weight: 560;
	}
	.n {
		min-width: 24px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.tight {
		gap: 0;
	}
	.second {
		padding-left: 48px;
	}
	@media (max-width: 520px) {
		.second {
			padding-left: 0;
		}
	}
	.prov {
		width: auto;
		max-width: 100%;
	}
	.fields {
		padding: var(--s-3);
		border-radius: var(--r);
		background: var(--surface-2);
		animation: rise-in var(--dur-2) var(--ease-out);
	}
	.newcat {
		padding-top: var(--s-4);
		border-top: 1px solid var(--border);
	}
	.newcat .name {
		font-family: var(--font);
		font-size: inherit;
		font-weight: 400;
	}
	.data {
		display: grid;
		gap: var(--s-5);
	}
	@media (min-width: 720px) {
		.data {
			grid-template-columns: 1fr 1fr;
		}
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		align-items: flex-start;
	}
	.block h3 {
		font-size: var(--fs);
	}
	.csvsel {
		width: auto;
		max-width: 220px;
	}
	.file {
		font: inherit;
		font-size: var(--fs-sm);
		max-width: 100%;
	}
	.file::file-selector-button {
		min-height: 36px;
		margin-right: var(--s-3);
		padding: 0 var(--s-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.modes {
		border: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
	}
	.acct {
		display: grid;
		gap: var(--s-2);
		margin: var(--s-3) 0 var(--s-4);
	}
	.acct div {
		display: flex;
		gap: var(--s-3);
	}
	.acct dt {
		width: 64px;
		flex: none;
		color: var(--text-2);
		font-size: var(--fs-sm);
	}
	.acct dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.about {
		text-align: center;
		max-width: 60ch;
		margin: 0 auto;
	}
	@media (prefers-reduced-motion: reduce) {
		.fields {
			animation: fade-in var(--dur-1) ease;
		}
	}
</style>
