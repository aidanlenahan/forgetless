# Notes for Aidan (from the build session)

## See it
```bash
cp .env.example .env        # then put your TMDB read token in TMDB_API_KEY=
docker compose up --build   # → http://localhost:3000, click "Try the demo" or sign up
```
Without Docker: `npm install && npm run dev` (dev runs on :3000).

## Decisions I made without you
- **SvelteKit 3** is current. It renamed `$lib` → `#lib` (with file extensions) and `$app/environment` → `$app/env`. See docs/ARCHITECTURE.md.
- **Client-rendered SPA** (`ssr = false`): the UI reads only from IndexedDB (Dexie), so it works offline. All writes go through an outbox.
- **TMDB ids** are stored as `movie:550` / `tv:95396`, because TMDB movie and TV ids overlap.
- **APP_ORIGIN is baked in at build time.** adapter-node 6 dropped the runtime `ORIGIN`. Compose passes it as a build arg, so change it in `.env` and rebuild.
- Demo guests get 24h; the purge runs at startup, hourly, and whenever a guest is created. The guest item cap defaults to 500 (`APP_GUEST_ITEM_CAP`).
- Your TMDB token was **not committed** anywhere. Put it in your local `.env`, which is gitignored.

## Verified in this session
- `npm run lint` (0 errors), `npm run check` (0 errors), `npm test` (35 unit tests), and `npm run test:e2e` (8 Playwright tests: capture, duplicate warning, pick-for-me, offline queue → sync, demo, log entries, manifest/SW/offline shell).
- With the real TMDB key: search "severance", then pick and save. It links to the real catalog entry with a poster.
- The Docker image builds and runs, with `/api/config` and demo creation OK.

## Not verified (needs you)
- Google/GitHub OAuth (needs client IDs), SMTP reset, installing on real iOS/Android devices, CI on GitHub Actions (first push will tell), Cloudflare Tunnel deploy.

See docs/TODO.md for the full checklist and next steps.
