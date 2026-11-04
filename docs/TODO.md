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
- [ ] Phase 2: catalog import, Letterboxd/Goodreads/IMDb import, Open Library, share target, priority.
