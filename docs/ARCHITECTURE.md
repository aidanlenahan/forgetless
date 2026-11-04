# Architecture (MVP)

Read this before changing code. It records the conventions every part of the app follows.

## Stack
SvelteKit **3** (adapter-node, Svelte 5 runes) · TypeScript · SQLite (`better-sqlite3`) + Drizzle · Better Auth · Dexie (IndexedDB) · vite-plugin-pwa · Vitest · Playwright.

### SvelteKit 3 gotchas (differs from Kit 2 docs!)
- Config lives in `vite.config.ts` (`sveltekit({ adapter, compilerOptions })`); there is no `svelte.config.js`.
- `$lib` is gone. Import with **`#lib/...` and an explicit extension**: `import { x } from '#lib/server/repo.ts'`, `import C from '#lib/components/C.svelte'`.
- `$app/environment` is now **`$app/env`** (`browser`, `dev`, `building`).
- Hook types (`Handle`, …) come from **`@sveltejs/kit/hooks`**. `json`, `error`, `redirect` still come from `@sveltejs/kit`.
- Page state: `import { page } from '$app/state'` (runes).
- Inside `src/lib/server/**` and `src/lib/shared/**`, plain relative imports (`./db`, `../shared/types`) are used so that Node scripts/tests can load them too.

## Layout
```
src/lib/shared/       types.ts (entities + sync/export formats), config.ts (APP_NAME)
src/lib/server/       env.ts (all config), db/ (schema, migrations runner), auth.ts (Better Auth),
                      repo.ts (pull/applyMutations/search/wipe — the ONLY writer of app tables),
                      seed.ts (default categories), guard.ts (requireUser)
src/lib/client/       db.ts (Dexie LocalDB, per-user), sync.ts (outbox + pull), mutations.ts (UI write helpers)
src/routes/api/       sync, config, auth (Better Auth at /api/auth/*), providers, export, import, demo
drizzle/              SQL migrations (0001 adds the FTS5 table). Run automatically on startup.
```

## Data flow (offline-first)
- **The UI reads only from Dexie** (`localDb()`, use `liveQuery` from dexie for reactivity).
- **The UI writes only through `src/lib/client/mutations.ts`**: it writes Dexie immediately and enqueues a
  mutation in the outbox; `sync.ts` flushes the outbox to `POST /api/sync` in order with backoff, then pulls
  `GET /api/sync?since=<cursor>`.
- Server upserts by client-generated UUIDv7 id with **last-write-wins on `updatedAt`**. Deletes are tombstones
  (`deletedAt`), so UI queries must filter `!deletedAt`.
- Server cursor = `server_updated_at` (monotonic server clock), never the client clock.
- Catalog entries (provider metadata) are a shared server cache. Client gets the ones referenced by its items via sync.

## Provider contract (server only)
```
GET  /api/providers/:id/search?q=...&kind=...  -> { hits: CatalogHit[] }      (LRU cached, rate limited)
POST /api/providers/:id/select { externalId, kind } -> { entry: CatalogEntry } (fetch details, upsert catalog_entries)
```
The client stores the returned entry into Dexie `catalogEntries` and saves the item with `catalogEntryId`.
A missing `TMDB_API_KEY` disables the provider (`/api/config` reports `providers.tmdb=false`) and the Watch
category behaves as custom-only.

## Config
Everything is in `src/lib/server/env.ts` and documented in `.env.example`. Env prefix is `APP_` (renaming-safe).

## Ratings
Stored 1–10, shown as 5 stars with half steps.
