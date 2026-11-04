# TODO

Tracks PRD progress. `[x]` done · `[~]` partial · `[ ]` not started.

## Phase 0 — Foundations
- [x] SvelteKit 3 skeleton (adapter-node, TS), Drizzle schema + migrations, FTS5 table
- [x] Better Auth (email/password; Google/GitHub behind env vars)
- [x] Offline-first client core: Dexie mirror, outbox, LWW sync API
- [ ] CI (lint, typecheck, unit, Playwright smoke, docker build)
- [ ] Dockerfile + docker-compose
- [ ] LICENSE (AGPL-3.0)

## Phase 1 — MVP (PRD build order)
1. [ ] Categories + custom items CRUD
2. [ ] Log entries
3. [ ] Quick capture with own-item autocomplete + duplicate warning
4. [ ] TMDB provider
5. [ ] Filters + pick-for-me
6. [ ] Export / import (JSON + CSV), round-trip test
7. [ ] PWA + offline outbox
8. [ ] Demo mode (guest + 24h purge)
9. [ ] Deploy the demo (Cloudflare Tunnel on own VM) — needs the owner

## Acceptance criteria (PRD §6)
- [ ] TMDB title in ≤3 taps; offline custom capture syncs
- [ ] Duplicate warning before saving
- [ ] Multiple log entries; sort by most recent log
- [ ] Pick for me respects filters
- [ ] JSON export → wipe → import identical (CI)
- [ ] Demo guest flow end-to-end; >24h guests purged
- [ ] Lighthouse PWA installable; iOS Safari + Android Chrome (manual check)
- [ ] 4 weeks of dogfooding
