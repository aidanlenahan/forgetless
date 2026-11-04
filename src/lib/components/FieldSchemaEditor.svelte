<script lang="ts">
	// Edit a category's custom field schema: add/remove fields with key, label, type and select options.
	import type { FieldDef, FieldType } from '#lib/shared/types.ts';
	import { slugKey } from '#lib/client/format.ts';

	interface Props {
		fields: FieldDef[];
		onchange: (fields: FieldDef[]) => void;
	}
	let { fields, onchange }: Props = $props();

	const TYPES: [FieldType, string][] = [
		['text', 'Text'],
		['long_text', 'Long text'],
		['number', 'Number'],
		['url', 'URL'],
		['select', 'Select'],
		['date', 'Date']
	];

	let newLabel = $state('');
	let newType = $state<FieldType>('text');

	function uniqueKey(base: string, except = -1) {
		let k = base;
		let n = 2;
		while (fields.some((f, i) => i !== except && f.key === k)) k = `${base}_${n++}`;
		return k;
	}
	function patch(i: number, p: Partial<FieldDef>) {
		const next = fields.map((f, j) => (j === i ? { ...f, ...p } : f));
		if (next[i].type !== 'select') delete next[i].options;
		onchange(next);
	}
	function add(e: SubmitEvent) {
		e.preventDefault();
		const label = newLabel.trim();
		if (!label) return;
		const f: FieldDef = { key: uniqueKey(slugKey(label)), label, type: newType };
		if (newType === 'select') f.options = [];
		onchange([...fields, f]);
		newLabel = '';
		newType = 'text';
	}
	function remove(i: number) {
		onchange(fields.filter((_, j) => j !== i));
	}
	function moveField(i: number, d: -1 | 1) {
		const j = i + d;
		if (j < 0 || j >= fields.length) return;
		const next = [...fields];
		[next[i], next[j]] = [next[j], next[i]];
		onchange(next);
	}
</script>

<div class="fse">
	{#if fields.length}
		<ul class="fields">
			{#each fields as f, i (f.key)}
				<li class="f">
					<div class="frow">
						<input
							class="input sm grow"
							value={f.label}
							aria-label="Field label"
							onchange={(e) => {
								const v = e.currentTarget.value.trim();
								if (v) patch(i, { label: v });
							}}
						/>
						<select
							class="select sm type"
							value={f.type}
							aria-label="Field type"
							onchange={(e) => patch(i, { type: e.currentTarget.value as FieldType })}
						>
							{#each TYPES as [t, l] (t)}<option value={t}>{l}</option>{/each}
						</select>
						<div class="row tight">
							<button
								type="button"
								class="btn ghost icon sm"
								onclick={() => moveField(i, -1)}
								disabled={i === 0}
								aria-label="Move {f.label} up">↑</button
							>
							<button
								type="button"
								class="btn ghost icon sm"
								onclick={() => moveField(i, 1)}
								disabled={i === fields.length - 1}
								aria-label="Move {f.label} down">↓</button
							>
							<button
								type="button"
								class="btn ghost icon sm danger"
								onclick={() => remove(i)}
								aria-label="Remove field {f.label}">✕</button
							>
						</div>
					</div>
					<div class="frow sub">
						<label class="xs faint key">
							key
							<input
								class="input sm mono"
								value={f.key}
								aria-label="Field key"
								onchange={(e) => {
									const v = slugKey(e.currentTarget.value);
									patch(i, { key: uniqueKey(v, i) });
								}}
							/>
						</label>
						{#if f.type === 'select'}
							<label class="xs faint grow opts">
								options
								<input
									class="input sm"
									value={(f.options ?? []).join(', ')}
									placeholder="Comma, separated, options"
									aria-label="Options for {f.label}"
									onchange={(e) =>
										patch(i, {
											options: [
												...new Set(
													e.currentTarget.value
														.split(',')
														.map((s) => s.trim())
														.filter(Boolean)
												)
											]
										})}
								/>
							</label>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="small faint">
			No custom fields. Add some, e.g. “Neighborhood”, “Price” (select), “Author”.
		</p>
	{/if}
	<form class="frow add" onsubmit={add}>
		<input
			class="input sm grow"
			bind:value={newLabel}
			placeholder="New field label"
			aria-label="New field label"
		/>
		<select class="select sm type" bind:value={newType} aria-label="New field type">
			{#each TYPES as [t, l] (t)}<option value={t}>{l}</option>{/each}
		</select>
		<button class="btn sm" disabled={!newLabel.trim()}>Add field</button>
	</form>
</div>

<style>
	.fse {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}
	.fields {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}
	.f {
		padding: var(--s-2);
		border-radius: var(--r);
		background: var(--surface);
		border: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}
	.frow {
		display: flex;
		gap: var(--s-2);
		align-items: center;
		flex-wrap: wrap;
	}
	.type {
		width: 120px;
	}
	.tight {
		gap: 0;
	}
	.sub label {
		display: flex;
		align-items: center;
		gap: var(--s-2);
	}
	.key .input {
		width: 140px;
	}
	.opts {
		min-width: 200px;
	}
	.mono {
		font-family: var(--font-mono);
	}
	.frow > :global(.grow),
	.frow > .grow {
		flex: 1 1 160px;
		width: auto;
		min-width: 0;
	}
</style>
