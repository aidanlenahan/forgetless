# Forgetless

One place to save every show, book, restaurant, and place you want to try, and remember who told you about it.
Capture something in a couple of taps (with TMDB autocomplete for movies and TV), note who recommended it and
why, log it when you've done it, and let "Pick for me" choose tonight's movie. Forgetless is an installable,
offline-first PWA: your lists are readable without a connection, and anything you add offline syncs when you're
back. It's self-hostable as a single Docker container with a single SQLite file. See [docs/PRD.md](docs/PRD.md)
for the product plan.

## Screenshots

| Quick capture (TMDB) | Item detail | Demo on mobile | Pick for me |
|---|---|---|---|
| ![](docs/screenshots/capture-tmdb.png) | ![](docs/screenshots/detail.png) | ![](docs/screenshots/demo-mobile.png) | ![](docs/screenshots/pick-mobile.png) |

_Coming soon._

## Quick start (Docker)

```sh
git clone <this repo> forgetless && cd forgetless
docker compose up --build
```

Open <http://localhost:3000> and click **Try the demo** for a throwaway guest account with sample data (guest
accounts are deleted after 24 hours), or sign up for a real account.

You don't need any config for this. Data is stored in `./data/app.db` on the host. To change settings, create a `.env` file
next to `docker-compose.yml` (copy [`.env.example`](.env.example)) and run `docker compose up --build -d` again.

> [!WARNING]
> Before anyone else can reach your instance, set a real `APP_AUTH_SECRET` in `.env`
> (`openssl rand -base64 32`). The compose default is public and not secret.

### TMDB (movie and TV autocomplete)

The **Watch** category gets posters and search results from [TMDB](https://www.themoviedb.org/). Without a key,
Watch still works, but only for custom items.

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to **Settings → API** (<https://www.themoviedb.org/settings/api>) and request an API key (choose
   "Developer", personal use is fine).
3. Copy the **API Read Access Token** (the long v4 token, _not_ the short v3 "API Key").
4. Put it in `.env`:
   ```sh
   TMDB_API_KEY=eyJhbGciOiJIUzI1NiJ9...
   ```
5. `docker compose up -d` (restart the container; no rebuild needed).

### Running on another host, port or behind a proxy

`APP_ORIGIN` must be the URL people type into the browser, for example `https://forgetless.example.com`.
SvelteKit 3 bakes the origin in **at build time** (there's no runtime `ORIGIN` variable anymore), so after you
change it, rebuild:

```sh
echo 'APP_ORIGIN=https://forgetless.example.com' >> .env
docker compose up --build -d
```

If the runtime value doesn't match the build, the container logs a warning at startup. Sign-in and form posts
fail until you rebuild.

## Configuration

All settings come from environment variables (see [`.env.example`](.env.example)). Docker Compose reads them from
`.env`.

| Variable | Default | Description |
| --- | --- | --- |
| `APP_ORIGIN` | `http://localhost:3000` | Public URL of the app (cookies, OAuth callbacks, CSRF). It's also needed at **build** time (Docker build arg). |
| `APP_AUTH_SECRET` | insecure dev value | Secret for signing sessions. **Set it in production**, using at least 32 random characters (`openssl rand -base64 32`). |
| `APP_DB_PATH` | `./data/app.db` (Docker: `/data/app.db`) | SQLite database file. Migrations run automatically on startup. |
| `APP_ALLOW_SIGNUP` | `true` | Allows new email/password sign-ups. Set it to `false` on a public demo instance. |
| `APP_DEMO_ENABLED` | `true` | Shows **Try the demo** (guest accounts that are wiped after 24 h). |
| `APP_GUEST_ITEM_CAP` | `500` | Maximum number of items per demo guest. |
| `TMDB_API_KEY` | _(empty)_ | TMDB v4 API Read Access Token. It enables the Watch autocomplete. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | _(empty)_ | Google OAuth. It's enabled only when both are set. Redirect URI: `<APP_ORIGIN>/api/auth/callback/google`. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | _(empty)_ | GitHub OAuth. It's enabled only when both are set. Callback URL: `<APP_ORIGIN>/api/auth/callback/github`. |
| `SMTP_URL` | _(empty)_ | SMTP connection URL for password-reset emails, e.g. `smtps://user:pass@smtp.example.com:465`. Without it, use the admin CLI. |
| `SMTP_FROM` | _(empty)_ | From address for those emails. |
| `PORT` | `3000` | HTTP port (adapter-node). |
| `BODY_SIZE_LIMIT` | `512K` (Docker: `10M`) | Maximum request body size (adapter-node). It's raised in the image so JSON imports fit. |
| `PROTOCOL_HEADER`, `HOST_HEADER`, `ADDRESS_HEADER`, `XFF_DEPTH` | _(unset)_ | adapter-node reverse-proxy settings, e.g. `ADDRESS_HEADER=cf-connecting-ip` behind Cloudflare so rate limits see real client IPs. |
| `APP_MIGRATIONS_DIR` | `./drizzle` | Location of the SQL migrations. You rarely need to change it. |

## Local development

Requires Node.js 22+.

```sh
npm install
cp .env.example .env    # optional
npm run dev             # http://localhost:3000
```

The service worker is only generated by production builds. To try the PWA and offline mode locally:

```sh
npm run build && npm start   # node build, http://localhost:3000
```

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` / `npm start` | Production build (`build/`) / run it with Node |
| `npm run check` | Type-check (svelte-check) |
| `npm run lint` / `npm run format` | Prettier check + ESLint / Prettier write |
| `npm test` | Unit tests (Vitest, `tests/unit`) |
| `npm run test:e2e` | Playwright smoke tests (`tests/e2e`). Builds the app and serves it on port 4173 |
| `npm run admin -- <command>` | Admin CLI (see below) |

For the end-to-end tests, run `npx playwright install chromium` once. If you already have a Chromium build somewhere, you can
point the tests at it: `PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

### PWA / offline

The PWA uses [`@vite-pwa/sveltekit`](https://github.com/vite-pwa/sveltekit), the SvelteKit 3 integration of
vite-plugin-pwa/Workbox. The manifest and icons are configured in `vite.config.ts`, and the service worker is in
`src/sw.ts`:

- The app shell (hashed JS/CSS, icons, manifest and the shell HTML at `/`) is precached, so the app opens offline.
- Navigations go to the network first and fall back to the cached shell when you're offline. The app is a client-rendered
  SPA, so every route shares that shell.
- `/api/**` is never cached by the service worker. Offline data lives in IndexedDB, and writes go to an outbox.
- TMDB poster images (`image.tmdb.org`) are cached cache-first, with a bounded number of entries.
- The manifest `id` is `/app` on purpose, so renaming the app doesn't change its installed identity.

## Admin CLI

`scripts/admin.ts` talks directly to the SQLite database (`APP_DB_PATH`):

```sh
npm run admin -- list-users
npm run admin -- reset-password <email> <new-password>
npm run admin -- purge-guests
```

In Docker, run it as the `node` user so any files it creates stay writable by the app:

```sh
docker compose exec -u node app npm run admin -- reset-password me@example.com 'new-password'
```

## Backups

Everything lives in one SQLite file (`./data/app.db` with Docker Compose).

- **Per user:** go to **Settings → Export** to download JSON (full fidelity, re-importable) and per-category CSV.
- **Whole instance, simple:** stop the container and copy `data/app.db`.
- **Whole instance, while running:** take a consistent snapshot with SQLite's `VACUUM INTO`:
  ```sh
  sqlite3 data/app.db "VACUUM INTO 'data/backup-$(date +%F).db'"
  ```
  (Don't just `cp` a live database; the `-wal` file may hold recent writes.)
- **Continuous / offsite:** [Litestream](https://litestream.io/) can stream the database to S3-compatible
  storage. Run it as a sidecar container that mounts the same `./data` volume.

To restore, stop the app, put the backup file in place as `data/app.db`, and start it again.

## Hosting behind Cloudflare Tunnel

Cloudflare Tunnel lets you host on your own machine or VM without opening ports:

1. Set `APP_ORIGIN=https://forgetless.example.com` (your tunnel hostname) and a real `APP_AUTH_SECRET` in `.env`,
   then `docker compose up --build -d`.
2. Create a tunnel (`cloudflared tunnel create forgetless`) and route the hostname to `http://localhost:3000`
   (or to `http://app:3000` if `cloudflared` runs in the same compose network).
3. Optional: set `ADDRESS_HEADER=cf-connecting-ip` so rate limits see the real client IP.
4. For a public demo instance, also set `APP_ALLOW_SIGNUP=false`.

## License

Forgetless is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you run
a modified version as a network service, you must offer its source code to that service's users. Outside
contributions will require signing a CLA (see [docs/PRD.md](docs/PRD.md) §11).

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.

<a href="https://www.themoviedb.org/"><img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="TMDB logo" height="16"></a>
