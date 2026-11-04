# TODO

Tracks PRD progress. `[x]` done · `[~]` partial · `[ ]` not started.

## Phase 0: Foundations
- [x] SvelteKit 3 skeleton (adapter-node, TS), Drizzle schema + migrations, FTS5 table
- [x] Better Auth (email/password; Google/GitHub behind env vars, **untested: no client IDs yet**)
- [x] Offline-first client core: Dexie mirror, outbox, LWW sync API
- [x] CI (lint, typecheck, unit, Playwright, docker build): `.github/workflows/ci.yml`, **not yet run on GitHub**
- [x] Dockerfile + docker-compose (image built + run locally)
- [x] LICENSE (AGPL-3.0). [ ] CLA Assistant bot (set up when the first outside PR arrives)

## Phase 1: MVP (PRD build order)
1. [x] Categories + custom items CRUD (custom fields, reorder, icons, providers)
2. [x] Log entries (multiple, half-star ratings, "done" prompts a log)
3. [x] Quick capture with own-item autocomplete + duplicate warning (`n` / `/` / FAB)
4. [x] TMDB provider (server-side, LRU + catalog cache, rate limited, link-match-later)
5. [x] Filters + sort + local search + pick-for-me (age-weighted, respects filters)
6. [x] Export / import (JSON full fidelity, CSV per category), round-trip unit test
7. [x] PWA (installable, offline shell, TMDB image cache) + offline outbox
8. [x] Demo mode (guest + seeded data + 24h purge at startup/hourly/on guest creation)
9. [ ] Deploy the demo (own VM + Cloudflare Tunnel): needs the owner

## Acceptance criteria (PRD §6)
- [x] TMDB title in ≤3 taps (n → type → pick result → Save); offline custom capture syncs (e2e)
- [x] Duplicate warning before saving (e2e)
- [x] Multiple log entries (e2e); sort by most recent log
- [x] Pick for me respects filters
- [x] JSON export → wipe → import identical (unit test, runs in CI)
- [x] Demo guest flow end-to-end (e2e); >24h guests purged (unit test)
- [~] Lighthouse PWA installable: manifest/SW/icons in place; **verify on a real iOS + Android device**
- [ ] 4 weeks of dogfooding

## Known gaps / next up
- [ ] SMTP password reset: `nodemailer` not installed (falls back to logging). Admin CLI reset works.
- [ ] Behind Cloudflare: configure Better Auth `advanced.ipAddress` headers (`cf-connecting-ip`) so IP rate limits work.
- [ ] Guest → real account conversion in place (today: export, sign up, import).
- [ ] Server FTS endpoint exists (`/api/search`) but the UI uses local search only.
- [ ] Better Auth uses scrypt for passwords (PRD said Argon2id); fine for now, revisit if desired.
- [ ] The build bakes in `APP_ORIGIN` (adapter-node 6 has no runtime ORIGIN). Rebuild the image if the public URL changes.
- [ ] Phase 2: Open Library, share target, priority, self-hosting extras (see below).

## Phase 2: Get data in
- [x] App imports: Letterboxd (ZIP or CSVs), IMDb (ratings + list exports), Goodreads (library export).
  `/import` page → `POST /api/import/apps/preview` → `POST /api/import/apps/commit` (background job) →
  `GET /api/import/apps/jobs/:id`. TMDB matching (IMDb ids via `/find`, Letterboxd by title + year ±1),
  throttled (4 at a time, 429 backoff), cached through `catalog_entries`. Duplicates skipped or merged.
  Unmatched rows become custom items with `needsMatch` (list filter `?match=1`). Unit + e2e tests.
- [x] Catalog import: `catalogs` table (migration 0002), rows in `catalog_entries` as `catalog:<id>`, private
  to the owner (search joins through `catalogs.user_id`; sync and JSON import drop other users' rows).
  Settings → list → Catalogs (upload, map columns, optional new fields, delete). Quick capture shows a
  "From your catalogs" group. Round-trips through export/import.
- Gaps:
  - [ ] Catalog search is server-only; no offline (Dexie) copy of catalog rows yet.
  - [ ] Import jobs and upload previews live in memory: a restart loses a running job (rows already written
    stay; re-running the import skips them). Single-instance only.
  - [ ] Letterboxd `likes/` and `lists/` are ignored; IMDb TV episodes and video games are imported as custom
    items without matching; Goodreads "Read Count" > 1 still gives one log entry (only one read date exported).
  - [ ] Custom (unmatched) items carry no year, so a re-import can only tell same-title remakes apart by their
    source link.
  - [ ] Deleting a list doesn't delete its catalogs (they become unreachable, not visible). `wipeUserData`
    (JSON import "replace") keeps catalogs.
  - [ ] No UI yet to rename a catalog or change its mapping (delete and re-upload).

## Phase 3: Remind me
- [x] Places provider (`osm`): `src/lib/server/providers/places.ts`. Photon search (POIs first, streets and
  addresses only as a fallback, Eat/Drink filtered to amenity/shop/craft tags, ranking by category), details
  from the picked Photon feature plus an optional Nominatim `/lookup` (extratags), 30-day details cache,
  instance-wide throttles (Photon ≤ 5 req/s, Nominatim ≤ 1 req/s), optional rounded location bias ("Near me").
  New users' Eat/Visit/Drink use it; existing users can pick it in Settings. Demo places link to real OSM
  elements. Item pages show address, hours, links and a 3×3-tile map; OSM attribution everywhere. Unit + e2e
  tests (e2e stubs the provider routes).
- Gaps:
  - [ ] Details for a place not seen in a recent search depend on Nominatim (the in-memory feature cache is lost
    on restart); with `NOMINATIM_URL=off` such a select fails until the user searches again.
  - [ ] No saved "home area" bias yet; without "Near me", bare names (e.g. "katz") rank worldwide.
  - [ ] Opening hours are shown as OSM writes them (no "open now", no localisation).
  - [ ] Imports don't match places (Letterboxd/IMDb/Goodreads only feed Watch/Read).
  - [ ] Map is a static 3×3 tile block at zoom 16 (no pan/zoom, no retina tiles).
