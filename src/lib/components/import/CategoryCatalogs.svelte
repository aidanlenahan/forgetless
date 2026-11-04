<script lang="ts">
	// Settings → a list → Catalogs: upload a CSV/JSON, map its columns, and use it as autocomplete in
	// quick capture for this list. Lists existing catalogs with row counts and lets you delete them.
	import FileDrop from './FileDrop.svelte';
	import { confirmDialog, toast } from '#lib/client/ui.svelte.ts';
	import { syncNow, syncStatus } from '#lib/client/sync.ts';
	import {
		catalogIndex,
		createCatalog,
		deleteCatalog,
		previewCatalog,
		refreshCatalogs
	} from '#lib/client/catalogs.svelte.ts';
	import type { Catalog, CatalogPreview, Category } from '#lib/shared/types.ts';

	let { category }: { category: Category } = $props();

	void refreshCatalogs();
	const catalogs = $derived<Catalog[]>(catalogIndex.byCategory[category.id] ?? []);

	let preview = $state<CatalogPreview | null>(null);
	let name = $state('');
	let busy = $state(false);
	let error = $state('');
	// target → column ('' = none)
	const TARGETS = [
		{ k: 'title', l: 'Title (required)', none: null },
		{ k: 'subtitle', l: 'Subtitle', none: 'None' },
		{ k: 'year', l: 'Year', none: 'None' },
		{ k: 'image', l: 'Image URL', none: 'None' },
		{ k: 'id', l: 'Unique id', none: 'Row number' }
	] as const;
	type Target = (typeof TARGETS)[number]['k'];
	let map = $state<Record<Target, string>>({
		title: '',
		subtitle: '',
		year: '',
		image: '',
		id: ''
	});
	const title = $derived(map.title);
	const subtitle = $derived(map.subtitle);
	const year = $derived(map.year);
	/** per extra column: '' = ignore, 'new' = new field, otherwise an existing field key */
	let extras = $state<Record<string, string>>({});

	const fieldKey = (label: string) =>
		label
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 40) || 'field';

	const used = $derived(new Set(Object.values(map).filter(Boolean)));
	const extraColumns = $derived(preview ? preview.headers.filter((h) => !used.has(h)) : []);
	const sample = $derived(preview ? preview.rows.slice(0, 5) : []);

	async function onFiles(files: File[]) {
		error = '';
		busy = true;
		try {
			const p = await previewCatalog(files[0]);
			preview = p;
			name = files[0].name.replace(/\.(csv|json|tsv|txt)$/i, '');
			map = {
				title: p.suggested.title,
				subtitle: p.suggested.subtitle ?? '',
				year: p.suggested.year ?? '',
				image: p.suggested.image ?? '',
				id: p.suggested.id ?? ''
			};
			const ex: Record<string, string> = {};
			for (const f of p.suggested.fields) {
				const existing = category.fieldSchema.find(
					(x) => x.key === f.key || x.label.toLowerCase() === f.label.toLowerCase()
				);
				ex[f.column] = existing ? existing.key : 'new';
			}
			extras = ex;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not read that file';
		} finally {
			busy = false;
		}
	}

	async function create() {
		if (!preview || !title) return;
		busy = true;
		error = '';
		try {
			const fields = extraColumns
				.filter((c) => extras[c])
				.map((c) => {
					const target = extras[c];
					const existing = category.fieldSchema.find((f) => f.key === target);
					return existing
						? { column: c, key: existing.key, label: existing.label }
						: { column: c, key: fieldKey(c), label: c.trim() };
				});
			const { catalog } = await createCatalog({
				previewId: preview.previewId,
				categoryId: category.id,
				name,
				mapping: {
					title: map.title,
					subtitle: map.subtitle || null,
					year: map.year || null,
					image: map.image || null,
					id: map.id || null,
					fields
				},
				addFields: fields.some((f) => !category.fieldSchema.some((x) => x.key === f.key))
			});
			await syncNow(); // picks up new fields on the list
			toast(`Added catalog “${catalog.name}” (${catalog.rowCount} rows)`, { kind: 'success' });
			preview = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not create the catalog';
		} finally {
			busy = false;
		}
	}

	async function remove(c: Catalog) {
		const ok = await confirmDialog({
			title: `Delete catalog “${c.name}”?`,
			message: 'Items you already saved from it stay as they are.',
			confirmLabel: 'Delete catalog',
			danger: true
		});
		if (!ok) return;
		try {
			await deleteCatalog(c.id);
			toast(`Deleted ${c.name}`);
		} catch (e) {
			toast(e instanceof Error ? e.message : 'Could not delete', { kind: 'error' });
		}
	}
</script>

<div class="stack catalogs" data-testid="category-catalogs">
	<p class="xs muted">
		A catalog is your own list of things (a CSV or JSON file) that quick capture suggests while you
		type in {category.name}.
	</p>
	{#if catalogs.length}
		<ul class="list">
			{#each catalogs as c (c.id)}
				<li class="row">
					<span class="grow truncate small"
						><strong>{c.name}</strong>
						<span class="faint num">· {c.rowCount} {c.rowCount === 1 ? 'row' : 'rows'}</span></span
					>
					<button type="button" class="btn ghost sm danger" onclick={() => remove(c)}>Delete</button
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if error}<p class="notice small" role="alert">{error}</p>{/if}

	{#if !preview}
		<FileDrop
			accept=".csv,.json,.tsv,.txt,text/csv,application/json"
			label={busy ? 'Reading…' : 'Add a catalog'}
			hint="CSV (with a header row) or a JSON array of objects. Max 20 MB."
			disabled={busy || !$syncStatus.online}
			testid="catalog-file"
			onfiles={onFiles}
		/>
	{:else}
		<div class="stack map">
			<p class="small">
				<strong>{preview.rowCount}</strong> rows. Choose which columns to use.
			</p>
			<label class="field">
				<span class="label">Catalog name</span>
				<input class="input sm" bind:value={name} maxlength="100" />
			</label>
			<div class="grid">
				{#each TARGETS as t (t.k)}
					<label class="field">
						<span class="label">{t.l}</span>
						<select class="select sm" bind:value={map[t.k]} data-testid="catalog-map-{t.k}">
							{#if t.none}<option value="">{t.none}</option>{/if}
							{#each preview.headers as h (h)}<option value={h}>{h}</option>{/each}
						</select>
					</label>
				{/each}
			</div>

			{#if extraColumns.length}
				<div class="stack">
					<span class="label">Other columns → fields on the item</span>
					{#each extraColumns as c (c)}
						<label class="row small">
							<span class="grow truncate">{c}</span>
							<select class="select sm extra" bind:value={extras[c]}>
								<option value="">Ignore</option>
								<option value="new">New field “{c}”</option>
								{#each category.fieldSchema as f (f.key)}<option value={f.key}
										>Field: {f.label}</option
									>{/each}
							</select>
						</label>
					{/each}
				</div>
			{/if}

			<div class="scroll">
				<table class="xs">
					<thead>
						<tr>
							<th>Title</th>
							{#if subtitle}<th>Subtitle</th>{/if}
							{#if year}<th>Year</th>{/if}
							{#each extraColumns.filter((c) => extras[c]) as c (c)}<th>{c}</th>{/each}
						</tr>
					</thead>
					<tbody>
						{#each sample as r, i (i)}
							<tr>
								<td>{r[title]}</td>
								{#if subtitle}<td>{r[subtitle]}</td>{/if}
								{#if year}<td>{r[year]}</td>{/if}
								{#each extraColumns.filter((c) => extras[c]) as c (c)}<td>{r[c]}</td>{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="row wrap">
				<button
					type="button"
					class="btn primary sm"
					disabled={busy || !title || !name.trim()}
					onclick={create}
					data-testid="catalog-create">Create catalog</button
				>
				<button type="button" class="btn ghost sm" onclick={() => (preview = null)}>Cancel</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: var(--s-2);
	}
	.extra {
		width: auto;
		max-width: 55%;
	}
	.scroll {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--r);
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		padding: var(--s-1) var(--s-2);
		text-align: left;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	th {
		color: var(--text-3);
		font-weight: 600;
	}
</style>
