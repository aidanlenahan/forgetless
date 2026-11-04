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
	import Icon from '#lib/components/Icon.svelte';
	import { tintStyle } from '#lib/client/visual.ts';
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
				title: 'Marked as done',
				intro: 'Log it while it’s fresh: the date, a rating, a line about it. Or skip.'
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
				message: `${formatDay(l.date)}${l.note ? `: “${l.note}”` : ''}`,
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
			message: 'Its log entries go with it, on every device you use.',
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
			? typeof entry.data?.tmdb_url === 'string'
				? (entry.data.tmdb_url as string)
				: // externalId is "movie:550" / "tv:95396"
					`https://www.themoviedb.org/${entry.externalId.replace(':', '/')}`
			: null
	);
</script>
<svelte:head><title>{item?.title ?? 'Item'} · Forgetless</title></svelte:head>

{#if !store.ready}
	<div class="loading" aria-busy="true" aria-label="Loading"><span class="spinner"></span></div>
{:else if !item}
	<div class="notfound card pad stack">
		<h1>Item not found</h1>
		<p class="muted">You may have deleted it, or it hasn't synced to this device yet.</p>
		<a class="btn" href="/">Back to All</a>
	</div>
{:else}
	<article class="detail" style={tintStyle(category)}>
		<nav class="crumbs" aria-label="Breadcrumb">
			<a href="/c/{item.categoryId}"
				><Icon name="back" size={16} /><span aria-hidden="true">{category?.icon}</span>
				{category?.name}</a
			>
		</nav>

		<header class="hero" class:poster={!!entry?.imageUrl}>
			<div class="art">
				<Poster
					src={entry?.imageUrl}
					alt={entry?.imageUrl ? `Poster for ${entry.title}` : ''}
					icon={category?.icon}
					title={item.title}
					width={176}
					eager
				/>
			</div>
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
				<p class="meta">
					{#if entry && entryMeta(entry)}<span>{entryMeta(entry)}</span>{/if}
					<span>Saved {timeAgo(item.createdAt)}</span>
				</p>
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
						<span class="row rating" title={ratingLabel(latest)}
							><StarRating value={latest} readonly size={18} /></span
						>
					{/if}
				</div>
				{#if item.needsMatch}
					<p class="needs small">
						You saved this offline as a custom item. Link it to TMDB to get the poster and details.
					</p>
				{/if}
				{#if canMatch}
					<button
						type="button"
						class="btn sm"
						onclick={() => (linkOpen = true)}
						data-testid="link-match"><Icon name="link" size={15} /> Link to TMDB</button
					>
				{/if}
			</div>
		</header>

		{#if overview || entryFacts.length}
			<section class="about" aria-label="About">
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
						{#if tmdbUrl}<a href={tmdbUrl} target="_blank" rel="noopener noreferrer"
								>View on TMDB <Icon name="external" size={12} /></a
							>{/if}
					</p>
				{/if}
			</section>
		{:else if isTmdb}
			<p class="attr xs faint">
				This product uses the TMDB API but is not endorsed or certified by TMDB.
			</p>
		{/if}

		<section class="context" aria-labelledby="ctx-h">
			<h2 id="ctx-h" class="section-title">Who told you</h2>
			<div class="quote">
				<span class="qmark" aria-hidden="true">“</span>
				<label class="sr-only" for="f-why">Why</label>
				<textarea
					id="f-why"
					class="why"
					rows="2"
					value={item.why ?? ''}
					placeholder="What made you want to try it?"
					onchange={(e) => update({ why: text(e.currentTarget.value) })}></textarea>
			</div>
			<div class="byline">
				<div class="field">
					<label for="f-by">Recommended by</label>
					<input
						id="f-by"
						class="input"
						list="by-list"
						value={item.recommendedBy ?? ''}
						placeholder="Who mentioned it"
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
							placeholder="Podcast, link, a walk past"
							onchange={(e) => update({ source: text(e.currentTarget.value) })}
							autocomplete="off"
						/>
						{#if isUrl(item.source)}<a
								class="btn icon"
								href={item.source}
								target="_blank"
								rel="noopener noreferrer"
								aria-label="Open source link"><Icon name="external" size={16} /></a
							>{/if}
					</div>
				</div>
				<div class="field full">
					<label for="f-tags">Tags</label>
					<input
						id="f-tags"
						class="input"
						list="tag-list"
						value={item.tags.join(', ')}
						placeholder="Separate with commas"
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
			<section class="card pad" aria-labelledby="det-h">
				<h2 id="det-h" class="section-title">Details</h2>
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

		<section class="logsec" aria-labelledby="log-h">
			<div class="row sect-head">
				<h2 id="log-h" class="section-title grow">
					Log <span class="lcount num">{logs.length || ''}</span>
				</h2>
				<button type="button" class="btn sm primary" onclick={addLog} data-testid="add-log"
					><Icon name="plus" size={15} /> Add entry</button
				>
			</div>
			{#if logs.length}
				<ol class="logs">
					{#each logs as l (l.id)}
						<li class="log" data-testid="log-entry">
							<span class="pin" aria-hidden="true"></span>
							<div class="lhead">
								<time class="ldate" datetime={l.date}>{formatDay(l.date)}</time>
								{#if l.rating != null}<StarRating value={l.rating} readonly size={14} />{/if}
								<span class="grow"></span>
								<span class="lact">
									<button type="button" class="btn ghost sm" onclick={() => editLog(l)}
										>Edit</button
									>
									<button
										type="button"
										class="btn ghost sm danger"
										onclick={() => removeLog(l)}
										aria-label="Delete entry from {formatDay(l.date)}">Delete</button
									>
								</span>
							</div>
							{#if l.note}<p class="note">{l.note}</p>{:else if l.rating == null}<p
									class="faint small"
								>
									No rating or note.
								</p>{/if}
						</li>
					{/each}
				</ol>
			{:else}
				<p class="muted small empty-log">
					Nothing logged yet. After you watch, read, visit or cook it, add the date and what you
					thought. You can log it more than once.
				</p>
			{/if}
		</section>

		<section class="manage" aria-label="Manage">
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
				><Icon name="trash" size={16} /> Delete</button
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
		gap: var(--s-6);
	}
	.crumbs {
		margin-bottom: calc(-1 * var(--s-4));
	}
	.crumbs a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 40px;
		padding-right: var(--s-2);
		color: var(--text-2);
		font-size: var(--fs-sm);
		font-weight: 550;
	}
	.crumbs a:hover {
		color: var(--text);
		text-decoration: none;
	}

	/* ---- Editorial header ---- */
	.hero {
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--s-5);
		align-items: end;
		isolation: isolate;
	}
	.art :global(.poster) {
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent),
			0 2px 4px rgb(40 25 10 / 0.12),
			0 12px 32px rgb(40 25 10 / 0.16);
	}
	.hmain {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		align-items: flex-start;
	}
	.title-input {
		width: calc(100% + var(--s-2));
		border: 1px solid transparent;
		border-radius: var(--r);
		background: transparent;
		color: var(--text);
		font-family: var(--font-serif);
		font-size: var(--fs-2xl);
		font-weight: 560;
		letter-spacing: -0.022em;
		line-height: 1.1;
		padding: 2px var(--s-2);
		margin-left: calc(-1 * var(--s-2));
		text-overflow: ellipsis;
		transition:
			border-color var(--dur-1) ease,
			background-color var(--dur-1) ease;
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
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--s-2);
		font-size: var(--fs-sm);
		color: var(--text-2);
	}
	.meta span + span::before {
		content: '·';
		margin-right: var(--s-2);
		color: var(--text-3);
	}
	.tagline {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: var(--fs-md);
		color: var(--text-2);
		max-width: 52ch;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		flex-wrap: wrap;
		margin-top: var(--s-1);
	}
	.status {
		width: auto;
		min-height: 36px;
		padding-top: 4px;
		padding-bottom: 4px;
		font-weight: 650;
		font-size: var(--fs-sm);
		border-radius: var(--r-pill);
		border-color: transparent;
		transition:
			background-color var(--dur-2) ease,
			color var(--dur-2) ease;
	}
	@media (pointer: coarse) {
		.status {
			min-height: 44px;
		}
	}
	.status.want {
		background-color: var(--accent-soft);
		color: var(--accent-text);
	}
	.status.in_progress {
		background-color: var(--warn-soft);
		color: var(--warn);
	}
	.status.done {
		background-color: var(--ok-soft);
		color: var(--ok);
	}
	.status.dropped {
		background-color: var(--surface-2);
		color: var(--text-2);
	}
	.needs {
		color: var(--warn);
		max-width: 52ch;
	}

	/* ---- About ---- */
	.about {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding-top: var(--s-5);
		border-top: 1px solid var(--border);
	}
	.overview {
		font-size: 1rem;
		line-height: 1.65;
		max-width: 68ch;
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: var(--s-3) var(--s-5);
		margin: 0;
	}
	.facts dt {
		font-size: var(--fs-xs);
		color: var(--text-2);
	}
	.facts dd {
		margin: 0;
		font-size: var(--fs-sm);
		font-weight: 550;
	}
	.attr a {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: inherit;
		text-decoration: underline;
	}

	/* ---- Who told you: the "why" as a pull-quote ---- */
	.context {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding: var(--s-5);
		border-radius: var(--r-lg);
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.quote {
		position: relative;
		padding-left: 34px;
	}
	.qmark {
		position: absolute;
		left: -2px;
		top: -14px;
		font-family: var(--font-serif);
		font-size: 4rem;
		line-height: 1;
		color: var(--accent);
		opacity: 0.85;
	}
	.why {
		display: block;
		width: 100%;
		min-height: 2.6em;
		field-sizing: content;
		resize: none;
		padding: 4px var(--s-2);
		margin-left: calc(-1 * var(--s-2));
		border: 1px solid transparent;
		border-radius: var(--r);
		background: transparent;
		color: var(--text);
		font-family: var(--font-serif);
		font-size: 1.375rem;
		font-style: italic;
		line-height: 1.4;
		letter-spacing: -0.005em;
		transition:
			border-color var(--dur-1) ease,
			background-color var(--dur-1) ease;
	}
	.why:hover {
		border-color: var(--border);
	}
	.why:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: var(--ring);
		background: var(--bg);
	}
	.byline {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--s-3);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--s-3);
		margin-top: var(--s-3);
	}
	@media (min-width: 640px) {
		.byline,
		.grid {
			grid-template-columns: 1fr 1fr;
		}
		.byline :global(.full),
		.grid :global(.full) {
			grid-column: 1 / -1;
		}
	}

	/* ---- Log as a timeline ---- */
	.sect-head {
		margin-bottom: var(--s-4);
	}
	.lcount {
		font-family: var(--font);
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text-2);
		margin-left: 4px;
	}
	.logs {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.log {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		padding: 0 0 var(--s-5) 28px;
	}
	/* The rail runs between pins; the last entry ends it. */
	.log::before {
		content: '';
		position: absolute;
		left: 5px;
		top: 16px;
		bottom: 0;
		width: 2px;
		border-radius: 1px;
		background: var(--border);
	}
	.log:last-child::before {
		display: none;
	}
	.pin {
		position: absolute;
		left: 0;
		top: 6px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--surface);
		border: 2px solid var(--accent);
	}
	.log:first-child .pin {
		background: var(--accent);
	}
	.lhead {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--s-1) var(--s-3);
		min-height: 24px;
	}
	.ldate {
		font-family: var(--font-serif);
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.lact {
		display: flex;
		gap: 2px;
		margin: -6px 0;
	}
	.note {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-width: 65ch;
		line-height: 1.55;
	}
	.empty-log {
		max-width: 60ch;
		padding: var(--s-3) var(--s-4);
		border-radius: var(--r-lg);
		border: 1px dashed var(--border-strong);
	}

	.manage {
		display: flex;
		align-items: flex-end;
		gap: var(--s-3);
		flex-wrap: wrap;
		padding-top: var(--s-5);
		border-top: 1px solid var(--border);
	}
	.mv {
		min-width: 200px;
	}

	/* ---- Phone ---- */
	@media (max-width: 639px) {
		.hero {
			grid-template-columns: 1fr;
			align-items: start;
			gap: var(--s-4);
		}
		.art :global(.poster) {
			width: 128px !important;
			height: 192px !important;
		}
		.hero:not(.poster) .art :global(.poster) {
			width: 96px !important;
			height: 144px !important;
		}
		.title-input {
			font-size: var(--fs-xl);
		}
		.context {
			padding: var(--s-4);
		}
		.why {
			font-size: 1.1875rem;
		}
	}
</style>
