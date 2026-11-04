<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { store } from '#lib/client/store.svelte.ts';
	import { session } from '#lib/client/session.svelte.ts';
	import { saveItem, deleteItem, deleteLogEntry } from '#lib/client/mutations.ts';
	import { distinctValues, parseTags } from '#lib/client/queries.ts';
	import { timeAgo, formatDay, isUrl, ratingLabel } from '#lib/client/format.ts';
	import { entryMeta } from '#lib/client/provider.ts';
	import { confirmDialog, toast } from '#lib/client/ui.svelte.ts';
	import Poster from '#lib/components/Poster.svelte';
	import StarRating from '#lib/components/StarRating.svelte';
	import LogEntryModal from '#lib/components/LogEntryModal.svelte';
	import LinkMatchModal from '#lib/components/LinkMatchModal.svelte';
	import CustomField from '#lib/components/CustomField.svelte';
	import {
		STATUSES,
		STATUS_LABELS,
		type Item,
		type LogEntry,
		type Status
	} from '#lib/shared/types.ts';

	const id = $derived(page.params.id ?? '');
	const item = $derived(store.itemById.get(id));
	const category = $derived(item ? store.categoryById.get(item.categoryId) : undefined);
	const entry = $derived(item?.catalogEntryId ? store.catalog.get(item.catalogEntryId) : undefined);
	const logs = $derived(store.logsByItem.get(id) ?? []);
	const latest = $derived(logs.find((l) => l.rating != null)?.rating ?? null);
	const recommenders = $derived(distinctValues(store.items.map((i) => i.recommendedBy)));
	const allTags = $derived(distinctValues(store.items.flatMap((i) => i.tags)));
	const canMatch = $derived(
		!!item &&
			category?.provider === 'tmdb' &&
			session.config.providers.tmdb &&
			(!item.catalogEntryId || item.needsMatch)
	);
	const isTmdb = $derived(entry?.source === 'tmdb');

	let logOpen = $state(false);
	let logEditing = $state<LogEntry | null>(null);
	let logIntro = $state<{ title: string; intro: string } | null>(null);
	let linkOpen = $state(false);

	function update(patch: Partial<Item>) {
		if (!item) return;
		void saveItem({ ...item, ...patch });
	}
	const text = (v: string) => (v.trim() ? v.trim() : null);

	function onStatus(s: Status) {
		if (!item) return;
		const was = item.status;
		update({ status: s });
		if (s === 'done' && was !== 'done') {
			logEditing = null;
			logIntro = {
				title: 'Marked as done 🎉',
				intro: 'Want to log it? Add a date, rating or note — or skip.'
			};
			logOpen = true;
		}
	}
	function addLog() {
		logEditing = null;
		logIntro = null;
		logOpen = true;
	}
	function editLog(l: LogEntry) {
		logEditing = l;
		logIntro = null;
		logOpen = true;
	}
	async function removeLog(l: LogEntry) {
		if (
			await confirmDialog({
				title: 'Delete this log entry?',
				message: `${formatDay(l.date)}${l.note ? ` — “${l.note}”` : ''}`,
				confirmLabel: 'Delete',
				danger: true
			})
		)
			await deleteLogEntry(l.id);
	}
	async function remove() {
		if (!item) return;
		const ok = await confirmDialog({
			title: `Delete “${item.title}”?`,
			message: 'Its log entries go with it. This syncs to all your devices.',
			confirmLabel: 'Delete',
			danger: true
		});
		if (!ok) return;
		const { id: itemId, categoryId } = item;
		await goto(`/c/${categoryId}`, { replace: true });
		await deleteItem(itemId);
		toast('Item deleted');
	}
	function move(categoryId: string) {
		if (!item || categoryId === item.categoryId) return;
		const c = store.categoryById.get(categoryId);
		update({ categoryId });
		toast(`Moved to ${c?.icon} ${c?.name}`);
	}

	/** Pull a few presentable facts out of provider data (shape varies by provider). */
	function facts(data: Record<string, unknown> | undefined): [string, string][] {
		if (!data) return [];
		const out: [string, string][] = [];
		const names = (v: unknown) =>
			Array.isArray(v)
				? v
						.map((x) => (typeof x === 'string' ? x : (x as { name?: string })?.name))
						.filter(Boolean)
						.join(', ')
				: '';
		const g = names(data.genres);
		if (g) out.push(['Genres', g]);
		const runtime = data.runtime ?? data.runtimeMinutes;
		if (typeof runtime === 'number' && runtime > 0)
			out.push([
				'Runtime',
				`${Math.floor(runtime / 60) ? `${Math.floor(runtime / 60)}h ` : ''}${runtime % 60}m`
			]);
		const seasons = data.numberOfSeasons ?? data.number_of_seasons ?? data.seasons;
		if (typeof seasons === 'number') out.push(['Seasons', String(seasons)]);
		const director = data.director ?? names(data.directors);
		if (typeof director === 'string' && director) out.push(['Director', director]);
		const cast = names(Array.isArray(data.cast) ? (data.cast as unknown[]).slice(0, 5) : undefined);
		if (cast) out.push(['Cast', cast]);
		const rel = data.releaseDate ?? data.release_date ?? data.firstAirDate ?? data.first_air_date;
		if (typeof rel === 'string' && rel)
			out.push([
				data.firstAirDate || data.first_air_date ? 'First aired' : 'Released',
				formatDay(rel)
			]);
		return out;
	}
	const overview = $derived(
		typeof entry?.data?.overview === 'string' ? (entry.data.overview as string) : null
	);
	const tagline = $derived(
		typeof entry?.data?.tagline === 'string' ? (entry.data.tagline as string) : null
	);
	const entryFacts = $derived(facts(entry?.data));
	const tmdbUrl = $derived(
		entry && isTmdb
			? `https://www.themoviedb.org/${entry.kind === 'tv' ? 'tv' : 'movie'}/${entry.externalId}`
			: null
	);
</script>

<svelte:head><title>{item?.title ?? 'Item'} · Forgetless</title></svelte:head>

{#if !store.ready}
	<div class="loading"><span class="spinner"></span></div>
{:else if !item}
	<div class="notfound card pad stack">
		<h1>Item not found</h1>
		<p class="muted">It may have been deleted, or it hasn't synced to this device yet.</p>
		<a class="btn" href="/">Back to All</a>
	</div>
{:else}
	<article class="detail">
		<nav class="crumbs small">
			<a href="/c/{item.categoryId}">← {category?.icon} {category?.name}</a>
		</nav>

		<header class="hero">
			{#if entry?.imageUrl}
				<Poster
					src={entry.imageUrl}
					alt="Poster for {entry.title}"
					icon={category?.icon}
					width={128}
					radius="var(--r)"
				/>
			{:else}
				<Poster icon={category?.icon} width={72} ratio={1} radius="var(--r-lg)" />
			{/if}
			<div class="hmain">
				<label class="sr-only" for="title-input">Title</label>
				<input
					id="title-input"
					class="title-input"
					value={item.title}
					onchange={(e) => {
						const v = e.currentTarget.value.trim();
						if (v) update({ title: v });
						else e.currentTarget.value = item.title;
					}}
					data-testid="item-title"
				/>
				<div class="meta small muted">
					{#if entry && entryMeta(entry)}{entryMeta(entry)} ·
					{/if}
					Added {timeAgo(item.createdAt)}
				</div>
				{#if tagline}<p class="tagline">{tagline}</p>{/if}
				<div class="controls">
					<label class="sr-only" for="status-select">Status</label>
					<select
						id="status-select"
						class="select status {item.status}"
						value={item.status}
						onchange={(e) => onStatus(e.currentTarget.value as Status)}
						data-testid="status-select"
					>
						{#each STATUSES as s (s)}<option value={s}>{STATUS_LABELS[s]}</option>{/each}
					</select>
					{#if latest != null}
						<span class="row" title={ratingLabel(latest)}
							><StarRating value={latest} readonly size={18} /></span
						>
					{/if}
				</div>
				{#if item.needsMatch}
					<p class="needs small">
						Saved offline as custom — link it to its TMDB entry for poster & details.
					</p>
				{/if}
				{#if canMatch}
					<button
						type="button"
						class="btn sm"
						onclick={() => (linkOpen = true)}
						data-testid="link-match">🔗 Link to TMDB match</button
					>
				{/if}
			</div>
		</header>

		{#if overview || entryFacts.length}
			<section class="card pad stack">
				{#if overview}<p class="overview">{overview}</p>{/if}
				{#if entryFacts.length}
					<dl class="facts">
						{#each entryFacts as [k, v] (k)}<div>
								<dt>{k}</dt>
								<dd>{v}</dd>
							</div>{/each}
					</dl>
				{/if}
				{#if isTmdb}
					<p class="attr xs faint">
						This product uses the TMDB API but is not endorsed or certified by TMDB.
						{#if tmdbUrl}<a href={tmdbUrl} target="_blank" rel="noopener noreferrer">View on TMDB</a
							>{/if}
					</p>
				{/if}
			</section>
		{:else if isTmdb}
			<p class="attr xs faint">
				This product uses the TMDB API but is not endorsed or certified by TMDB.
			</p>
		{/if}

		<section class="card pad">
			<h2 class="section-title">Context</h2>
			<div class="grid">
				<div class="field">
					<label for="f-by">Recommended by</label>
					<input
						id="f-by"
						class="input"
						list="by-list"
						value={item.recommendedBy ?? ''}
						onchange={(e) => update({ recommendedBy: text(e.currentTarget.value) })}
						autocomplete="off"
					/>
					<datalist id="by-list"
						>{#each recommenders as r (r)}<option value={r}></option>{/each}</datalist
					>
				</div>
				<div class="field">
					<label for="f-src">Source</label>
					<div class="row">
						<input
							id="f-src"
							class="input"
							value={item.source ?? ''}
							onchange={(e) => update({ source: text(e.currentTarget.value) })}
							autocomplete="off"
						/>
						{#if isUrl(item.source)}<a
								class="btn icon"
								href={item.source}
								target="_blank"
								rel="noopener noreferrer"
								aria-label="Open source link">↗</a
							>{/if}
					</div>
				</div>
				<div class="field full">
					<label for="f-why">Why</label>
					<textarea
						id="f-why"
						class="textarea"
						rows="2"
						value={item.why ?? ''}
						onchange={(e) => update({ why: text(e.currentTarget.value) })}></textarea>
				</div>
				<div class="field full">
					<label for="f-tags">Tags</label>
					<input
						id="f-tags"
						class="input"
						list="tag-list"
						value={item.tags.join(', ')}
						placeholder="comma, separated"
						onchange={(e) => update({ tags: parseTags(e.currentTarget.value) })}
						autocomplete="off"
					/>
					<datalist id="tag-list"
						>{#each allTags as t (t)}<option value={[...item.tags, t].join(', ')}>#{t}</option
							>{/each}</datalist
					>
				</div>
			</div>
		</section>

		{#if category?.fieldSchema.length}
			<section class="card pad">
				<h2 class="section-title">Details</h2>
				<div class="grid">
					{#each category.fieldSchema as f (f.key)}
						<CustomField
							def={f}
							value={item.customFields[f.key]}
							onchange={(v) => update({ customFields: { ...item.customFields, [f.key]: v } })}
						/>
					{/each}
				</div>
			</section>
		{/if}

		<section class="card pad">
			<div class="row sect-head">
				<h2 class="section-title grow">Log · {logs.length}</h2>
				<button type="button" class="btn sm primary" onclick={addLog} data-testid="add-log"
					>＋ Add log entry</button
				>
			</div>
			{#if logs.length}
				<ul class="logs">
					{#each logs as l (l.id)}
						<li class="log" data-testid="log-entry">
							<div class="ldate">{formatDay(l.date)}</div>
							<div class="lbody">
								{#if l.rating != null}<StarRating value={l.rating} readonly size={15} />{/if}
								{#if l.note}<p class="note">{l.note}</p>{:else if l.rating == null}<p
										class="faint small"
									>
										No rating or note
									</p>{/if}
							</div>
							<div class="lact">
								<button type="button" class="btn ghost sm" onclick={() => editLog(l)}>Edit</button>
								<button
									type="button"
									class="btn ghost sm danger"
									onclick={() => removeLog(l)}
									aria-label="Delete entry from {formatDay(l.date)}">Delete</button
								>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted small empty-log">
					No entries yet. When you watch, visit, read or cook it, log it here — with a rating and a
					note. Repeats welcome.
				</p>
			{/if}
		</section>

		<section class="manage">
			<label class="field mv">
				<span class="label">Move to</span>
				<select
					class="select sm"
					value={item.categoryId}
					onchange={(e) => move(e.currentTarget.value)}
					data-testid="move-select"
				>
					{#each store.categories as c (c.id)}<option value={c.id}>{c.icon} {c.name}</option>{/each}
				</select>
			</label>
			<div class="grow"></div>
			<button type="button" class="btn danger" onclick={remove} data-testid="delete-item"
				>Delete item</button
			>
		</section>
	</article>

	<LogEntryModal
		open={logOpen}
		itemId={item.id}
		entry={logEditing}
		title={logIntro?.title}
		intro={logIntro?.intro}
		onclose={() => (logOpen = false)}
	/>
	<LinkMatchModal open={linkOpen} {item} onclose={() => (linkOpen = false)} />
{/if}

<style>
	.loading {
		display: grid;
		place-items: center;
		padding: var(--s-7);
		color: var(--text-3);
	}
	.notfound {
		max-width: 480px;
	}
	.detail {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}
	.crumbs a {
		color: var(--text-2);
	}
	.hero {
		display: flex;
		gap: var(--s-4);
		align-items: flex-start;
	}
	.hmain {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		align-items: flex-start;
	}
	.title-input {
		width: 100%;
		border: 1px solid transparent;
		border-radius: var(--r);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-xl);
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.2;
		padding: 2px var(--s-2);
		margin-left: calc(-1 * var(--s-2));
	}
	.title-input:hover {
		border-color: var(--border);
	}
	.title-input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: var(--ring);
		background: var(--surface);
	}
	.tagline {
		font-style: italic;
		color: var(--text-2);
		font-size: var(--fs-sm);
	}
	.controls {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		flex-wrap: wrap;
	}
	.status {
		width: auto;
		min-height: 34px;
		padding-top: 4px;
		padding-bottom: 4px;
		font-weight: 600;
		font-size: var(--fs-sm);
		border-radius: var(--r-pill);
	}
	.status.want {
		background-color: var(--accent-soft);
		color: var(--accent-text);
		border-color: transparent;
	}
	.status.in_progress {
		background-color: var(--warn-soft);
		color: var(--warn);
		border-color: transparent;
	}
	.status.done {
		background-color: var(--ok-soft);
		color: var(--ok);
		border-color: transparent;
	}
	.needs {
		color: var(--warn);
	}
	.overview {
		line-height: 1.6;
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: var(--s-2) var(--s-4);
		margin: 0;
	}
	.facts dt {
		font-size: var(--fs-xs);
		color: var(--text-3);
	}
	.facts dd {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.attr a {
		color: inherit;
		text-decoration: underline;
	}
	.section-title {
		margin-bottom: var(--s-3);
	}
	.sect-head .section-title {
		margin-bottom: 0;
	}
	.sect-head {
		margin-bottom: var(--s-3);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--s-3);
	}
	@media (min-width: 640px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
		.grid :global(.full) {
			grid-column: 1 / -1;
		}
	}
	.logs {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.log {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-areas: 'date act' 'body body';
		gap: var(--s-1) var(--s-3);
		padding: var(--s-3) 0;
		border-top: 1px solid var(--border);
	}
	.log:first-child {
		border-top: none;
		padding-top: 0;
	}
	@media (min-width: 640px) {
		.log {
			grid-template-columns: 120px 1fr auto;
			grid-template-areas: 'date body act';
			align-items: start;
		}
	}
	.ldate {
		grid-area: date;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.lbody {
		grid-area: body;
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		min-width: 0;
	}
	.lact {
		grid-area: act;
		display: flex;
		gap: 2px;
	}
	.note {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.empty-log {
		padding: var(--s-2) 0;
	}
	.manage {
		display: flex;
		align-items: flex-end;
		gap: var(--s-3);
		flex-wrap: wrap;
		padding-top: var(--s-2);
	}
	.mv {
		min-width: 180px;
	}
	@media (max-width: 480px) {
		.hero {
			gap: var(--s-3);
		}
		.hero :global(.poster) {
			max-width: 96px;
			max-height: 144px;
		}
		.title-input {
			font-size: var(--fs-lg);
		}
	}
</style>
