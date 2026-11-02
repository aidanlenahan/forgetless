# PRD: Universal "Want-To" Tracker

> Working name: Forgetless (renameable; see §11). Status: draft v2. Owner: Aidan Lenahan. Date: 2026-10-15.

## 1. Problem

People constantly hear about things they want to try: a show a friend mentions, a restaurant passed on a walk, a book from a podcast. They forget most of them, or they save them in five scattered places (Notes app, screenshots, Google Maps stars, Letterboxd, texts to self). Later, when they actually have a free evening, they can't remember any of it, or who recommended it, or whether they already tried it and what they thought.

Existing tools are siloed by category (Letterboxd, Goodreads, Beli) or are blank canvases (Notes, Notion) that have no autocomplete or structure.

**Thesis:** one fast capture box for *every* category, with database autocomplete where it exists, free-form custom items where it doesn't, and remembered context ("Sam recommended this").

## 2. Users

- **Primary:** a forgetful person who saves things on impulse and decides later. Mobile-first capture, desktop or mobile browsing.
- **Secondary:** self-hosters (homelab / r/selfhosted audience) who run their own instance via Docker.
- **Demo visitor:** evaluates the app in under 2 minutes without signing up.

## 3. Core jobs (in priority order)

1. **Capture in <5 seconds**: from opening the app to the item being saved, with or without a database match.
2. **Remember context**: who recommended it, where you heard about it, and why.
3. **Decide later**: filter the list and get "pick one for me".
4. **Log what you did**: dated entries with a rating and notes. Supports repeats (rewatch, revisit) so you never redo something you disliked.

## 4. Product principles

- **Custom-first, database-enhanced.** Every category works with zero external data. A provider only adds autocomplete and metadata.
- **Your own history is the first autocomplete source.** It also catches duplicates ("Already on your Watch list, added 3 months ago, from Sam").
- **Never block capture.** Capture works offline, works with no match, and has no required fields beyond the title.
- **Your data is yours.** Full export and import from day one.

## 5. Key concepts

| Concept | Description |
|---|---|
| **Category** | A list type owned by the user, e.g. Watch, Eat, Read, or "Board games". It has a name, an icon, optional custom fields, and an optional provider. Defaults are seeded but fully editable or deletable. |
| **Provider** | An adapter to an external database (TMDB, Open Library, …) that implements `search(query)` and `getDetails(id)`. A category has 0 or 1 provider. |
| **Catalog** | A user-imported CSV/JSON list that acts like a local provider (autocomplete source) for a category. *(Phase 2)* |
| **Item** | One thing the user wants or did. It may link to a provider or catalog entry, or be fully custom. |
| **Status** | `want` → `in_progress` → `done`, plus `dropped`. |
| **Log entry** | A dated record on an item (watched, visited, read, cooked) with an optional rating (1–5, half steps) and a note. An item can have many. |
| **Context** | Fields on an item: `recommended_by` (autocompletes from people you've used before), `source` (free text or URL), `why` (note), and tags. |

## 6. MVP (Phase 1) scope

**Goal:** a usable daily-driver for one person, plus a public sandbox demo. One external provider only.

### Included

**Auth**
- Email + password, plus Google and GitHub OAuth. Each OAuth provider can be turned on or off with env vars, so self-hosters can run with password auth only.
- Password reset via email if SMTP is configured; otherwise an admin CLI command resets it.

**Categories**
- Seeded defaults: **Watch** (TMDB provider), **Read, Eat, Visit, Drink, Cook** (custom, no provider yet).
- Create, rename, reorder, and delete categories; change the icon.
- Custom field types: `text`, `long text`, `number`, `url`, `select`, `date`.

**Quick capture** (global "+" button and `/` or `n` keyboard shortcut)
- Single input. The category comes from the current view or a chip row.
- Results appear in three groups as you type:
  1. Matching items you already have (duplicate warning).
  2. Provider results (TMDB: poster, year, movie/TV).
  3. `Add "<text>" as custom item`.
- After selecting, an optional context sheet appears: recommended by, source, why, tags, status. Its default is `want`, and one tap saves.
- Results are debounced (~200 ms) and appear within 500 ms p95 on a warm cache.

**Items**
- Detail view showing metadata, context, custom fields, status, and log entries.
- Add, edit, and delete log entries. Marking an item `done` prompts for an optional quick log entry (date defaults to today, rating, note).
- A custom item can be linked to a provider match later.

**Lists and decide**
- Per-category list plus an "All" view.
- Filter by status, tag, recommended-by, and has-rating. Sort by added date, last log entry, rating, or title.
- **Pick for me:** a random choice from the current filtered set, weighted toward older items. Re-roll is available.
- Full-text search across your own items.

**PWA and offline**
- Installable on iOS, Android, and desktop browsers.
- Offline: the app shell and the user's lists are cached and readable. New items, edits, and log entries go into an outbox and sync when back online. Provider search shows "offline: will save as custom, match later".

**Data ownership**
- Export everything as JSON (full fidelity) and per-category CSV.
- Import your own JSON export. A round-trip test covers this in CI.

**Public demo**
- A "Try the demo" button creates a guest account seeded with sample data.
- Guest accounts and their data are wiped 24 h after creation (purge runs at app startup and on each guest sign-in).
- Rate limits apply to the provider proxy and to writes. Signups on the demo instance are disabled by config.

**Repo**
- GitHub repo with CI (lint, typecheck, unit tests, a Playwright smoke test).
- `Dockerfile` (needed to host the demo anyway).
- README covering setup and env vars, and a license (see §11).

### Explicitly out of MVP

Additional providers, CSV catalog import, Letterboxd/Goodreads/IMDb import, notifications, episode or page progress, sharing, OIDC, Postgres, and native apps.

### MVP acceptance criteria

- [ ] Capture a TMDB title in ≤3 taps from app open; capture a custom item while offline and see it sync.
- [ ] Adding a title that is already on a list shows a duplicate warning before saving.
- [ ] An item can hold multiple log entries; the list can sort by most recent log entry.
- [ ] "Pick for me" respects active filters.
- [ ] JSON export → wipe → import restores identical data (CI test).
- [ ] The demo guest flow works end-to-end, and guest data older than 24 h is purged automatically.
- [ ] Lighthouse PWA installable; works on iOS Safari (installed) and Android Chrome.
- [ ] You use it yourself for 4 straight weeks (dogfooding gate before Phase 2).

## 7. Technical design

### Stack
- **SvelteKit** (adapter-node), TypeScript.
- **SQLite** via `better-sqlite3`, **Drizzle ORM** with migrations, **FTS5** for search.
- **Better Auth** (email/password plus OAuth providers).
- **vite-plugin-pwa** (Workbox) for the service worker.
- **Dexie** (IndexedDB) for the offline cache and outbox.
- Tests: Vitest and Playwright.
- One container image. The DB is a single file on a mounted volume.

Postgres support is deferred. Keep Drizzle queries dialect-neutral, avoiding SQLite-only SQL outside the FTS layer.

### Data model (MVP)

```
users            id, email, name, created_at, is_guest, guest_expires_at
accounts/sessions  (managed by Better Auth)

categories       id (uuidv7), user_id, name, icon, sort, provider (nullable, e.g. 'tmdb'),
                 field_schema (json: [{key, label, type, options?}]), created_at, updated_at, deleted_at

catalog_entries  id, source ('tmdb' | 'catalog:<id>'), external_id, kind ('movie'|'tv'|…),
                 title, subtitle, year, image_url, data (json), fetched_at
                 UNIQUE(source, external_id)

items            id (uuidv7, client-generated), user_id, category_id, catalog_entry_id (nullable),
                 title, status, recommended_by, source, why,
                 custom_fields (json), created_at, updated_at, deleted_at

item_tags        item_id, tag   (tag text, case-insensitive per user)

log_entries      id (uuidv7, client-generated), item_id, date, rating (nullable, 1-10 = half stars),
                 note, created_at, updated_at, deleted_at

items_fts        FTS5 over title, recommended_by, source, why, tags
```

- **Client-generated UUIDv7 IDs** make queued offline writes idempotent and sortable.
- **Soft deletes (`deleted_at`)** act as tombstones so deletions sync.
- `catalog_entries` is a shared server-side cache. Provider data is fetched once and reused across users.

### Provider interface

```ts
interface Provider {
  id: string;                         // 'tmdb'
  kinds: string[];                    // ['movie','tv']
  search(q: string, opts): Promise<CatalogHit[]>;
  getDetails(externalId: string): Promise<CatalogEntry>;
  attribution: { text: string; logo?: string; url: string };
}
```

- Providers run **server-side only**: API keys never reach the client, the server rate-limits and caches, and the provider can be swapped later.
- A missing API key disables the provider, and its categories fall back to custom-only.
- Phase 2 catalogs implement the same interface backed by local tables.

### Sync (offline read + queued adds)

- **Read:** on load and when the app regains focus, pull `GET /api/sync?since=<cursor>`, which returns changed categories, items, and log entries, and stores them in Dexie. The UI reads from Dexie.
- **Write:** every mutation goes to a Dexie outbox *and* applies optimistically. The outbox flushes in order and retries with backoff when back online. The server upserts by ID.
- **Conflicts:** last-write-wins per row using `updated_at`. This is acceptable for a single-user, multi-device app; revisit when sharing arrives.
- Offline capture can't hit TMDB, so it saves a custom item flagged `needs_match`. When back online, the app suggests a match.

### Search and autocomplete

- Own-items results come from local Dexie, so they work instantly and offline.
- Provider results come from `/api/providers/:id/search`, cached in-memory (LRU) and in `catalog_entries`.
- `recommended_by` and tags autocomplete from the user's distinct existing values.

### Backups

- **Per-user:** JSON and CSV export (MVP).
- **Instance:** nightly `VACUUM INTO` snapshot to `/data/backups` with N-day retention (Phase 2). Document Litestream for people who want offsite backups.

### Security and abuse

- Argon2id password hashing (Better Auth default), CSRF protection, secure cookies.
- Rate limits per user and per IP on auth, provider search, and writes.
- The demo instance additionally caps items per guest and import size.

## 8. Phases

Each phase ships something usable.

### Phase 0: Foundations (~1–2 weeks)
- Repo, CI, SvelteKit skeleton, Drizzle schema and migrations, Better Auth, base layout, Dockerfile.
- Pick the name and license.

### Phase 1: MVP (~6–8 weeks of evenings and weekends)
- Everything in §6.
- Build order:
  1. Categories and custom items CRUD.
  2. Log entries.
  3. Quick capture with own-item autocomplete.
  4. TMDB provider.
  5. Filters and pick-for-me.
  6. Export/import.
  7. PWA and offline outbox.
  8. Demo mode.
  9. Deploy the demo.

### Phase 2: Get data in (self-host ready)
- **Catalog import:** upload CSV/JSON to a category, map columns to title/subtitle/year/image/fields, and use it as an autocomplete source.
- **App imports:** Letterboxd (CSV export), IMDb lists/ratings (CSV), Goodreads (CSV). Imported items match to providers where possible and otherwise become custom items with log entries.
- **Second provider:** Open Library for Read.
- **Self-hosting:** `docker-compose.yml`, self-hosting docs, nightly instance backups, admin settings page (toggle signups, OAuth, SMTP).
- **Android share target:** share a link or text from any app into quick capture. iOS doesn't support Web Share Target; see Phase 5.
- **Priority:** optional low/normal/high field on items. It is hidden by default and feeds pick-for-me weighting and the Phase 3 digest.

### Phase 3: Remind me
- **Notification channels:** email (SMTP) and Web Push (iOS requires the installed PWA, iOS 16.4+).
- **Rule-based notifications** (no AI). All are per-user toggles with per-category scope:
  - *Release alerts:* a `want` movie or TV item gets a release date, a new season, or becomes available on the user's selected streaming services (TMDB watch-provider data, which requires JustWatch attribution).
  - *Digest:* weekly or monthly email with N items per category. Score = `age_days × (1 + priority)`, skipping items surfaced in the last 30 days.
  - *Resurface:* "You added this 6 months ago and haven't touched it. Still want it?" with buttons for keep, drop, or snooze.
- Quiet hours and a global frequency cap.
- **TV progress:** seasons and episodes from TMDB; status moves to `in_progress` automatically.
- **Places provider:** Foursquare Open Source Places or OSM (Nominatim/Overpass) for Eat and Visit. Google Places only as optional bring-your-own-key, because its ToS restricts caching.

### Phase 4: Social and scale
- Shared lists (co-editing; replace LWW with field-level merge).
- Public read-only list links.
- Send an item to another user.
- OIDC login (Authelia, Authentik, Keycloak) for homelabs.
- Optional Postgres for larger public instances.

### Phase 5: Native and beyond
- **Tauri desktop:** global quick-capture hotkey, tray icon.
- **Capacitor mobile wrapper:** iOS share sheet, background location for "you're near a place on your Eat list".
- Recipe and drink providers (TheMealDB, TheCocktailDB) if demand appears.
- Monetization experiments (§10).

## 9. Success metrics

This is a side project, so success means *real use*, not growth:
- **Dogfood:** ≥4 items captured per week by you for 8 weeks; you actually used "pick for me" or the list to make decisions.
- **Capture speed:** median time from open to saved ≤5 s (measured in the app with local timing, no third-party analytics).
- **Context rate:** ≥40% of items have `recommended_by` or `source`. If it's lower, the context sheet is too much friction.
- **Validation:** of 10 forgetful friends given the demo, how many are still capturing after 3 weeks? That number decides whether this stays a side project.

## 10. Positioning and monetization (honest take)

You're right that this isn't a burning problem. It's a **convenience/retention product**, like Letterboxd or Beli, and those do have paying users. The defensible angle is *cross-category plus context plus your own data*. If the friend test shows retention, the standard open-source path is:

- Open-source self-host stays free.
- Paid hosted version: sync, push/email notifications, and backups handled for you, at ~$2–4/mo or lifetime.

Licensing constraints if you go commercial:
- **TMDB:** the free API terms are for non-commercial use; commercial use needs a TMDB commercial agreement.
- **IMDb datasets:** non-commercial license, so don't build on them. TMDB is the right choice.
- **Google Places:** paid, and caching is restricted.
- **Open Library and OSM:** fine with attribution. OSM is ODbL.

Stevens/iSTEM relevance: the data model (custom categories plus pluggable providers) is the interesting technical contribution. Pitch it that way, not as "another watchlist".

## 11. Open decisions

| Decision | Status |
|---|---|
| Name | **Forgetless** (working name). Renaming stays cheap if the name lives in one config constant, the PWA manifest `id` is a neutral, stable value (e.g. `/app`) rather than the name, and the DB filename, env var prefix and package names are generic (`app.db`, `APP_*`). |
| License | **AGPL-3.0 + CLA** (CLA Assistant bot from the first outside PR). This keeps the option to dual-license or build proprietary hosted features later. |
| Hosting | **Decided:** your own VM behind **Cloudflare Tunnel** for both the demo and your personal instance ($0). Fly.io (~$2–5/mo, no free tier for new accounts) is the fallback if uptime matters later. Not Replit: its deployments don't keep a persistent local disk. The guest-data purge runs at startup and on guest sign-in, so it doesn't depend on cron and works on any host. |
| Rating scale | **Decided:** 5 stars with half steps, stored as 1–10. |
| Priority | **Decided:** not in the MVP; added in Phase 2. |
