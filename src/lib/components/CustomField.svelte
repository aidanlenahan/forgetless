<script lang="ts">
	// One custom field input rendered from a category's fieldSchema entry. Saves on change.
	import type { FieldDef } from '#lib/shared/types.ts';
	import { isUrl } from '#lib/client/format.ts';

	interface Props {
		def: FieldDef;
		value: unknown;
		onchange: (v: unknown) => void;
	}
	let { def, value, onchange }: Props = $props();
	const id = $derived(`cf-${def.key}`);
	const str = $derived(value == null ? '' : String(value));
	const full = $derived(def.type === 'long_text');
	const clean = (s: string) => (s.trim() ? s.trim() : null);
</script>

<div class="field" class:full>
	<label for={id}>{def.label}</label>
	{#if def.type === 'long_text'}
		<textarea
			{id}
			class="textarea"
			rows="3"
			value={str}
			onchange={(e) => onchange(clean(e.currentTarget.value))}></textarea>
	{:else if def.type === 'number'}
		<input
			{id}
			class="input"
			type="number"
			inputmode="decimal"
			step="any"
			value={str}
			onchange={(e) => {
				const v = e.currentTarget.value;
				onchange(v === '' || Number.isNaN(Number(v)) ? null : Number(v));
			}}
		/>
	{:else if def.type === 'url'}
		<div class="row">
			<input
				{id}
				class="input"
				type="url"
				inputmode="url"
				placeholder="https://"
				value={str}
				onchange={(e) => onchange(clean(e.currentTarget.value))}
			/>
			{#if isUrl(str)}<a
					class="btn icon"
					href={str}
					target="_blank"
					rel="noopener noreferrer"
					aria-label="Open {def.label}">↗</a
				>{/if}
		</div>
	{:else if def.type === 'select'}
		<select
			{id}
			class="select"
			value={str}
			onchange={(e) => onchange(e.currentTarget.value || null)}
		>
			<option value="">—</option>
			{#each def.options ?? [] as o (o)}<option value={o}>{o}</option>{/each}
			{#if str && !(def.options ?? []).includes(str)}<option value={str}>{str}</option>{/if}
		</select>
	{:else if def.type === 'date'}
		<input
			{id}
			class="input"
			type="date"
			value={str}
			onchange={(e) => onchange(e.currentTarget.value || null)}
		/>
	{:else}
		<input
			{id}
			class="input"
			value={str}
			onchange={(e) => onchange(clean(e.currentTarget.value))}
		/>
	{/if}
</div>
