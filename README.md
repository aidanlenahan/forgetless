# Forgetless

Save the shows, books, restaurants and places people tell you to try, and who told you about each one.
Type a title and it's saved in a couple of seconds, with TMDB autocomplete for movies and TV. Add who
recommended it and why, log it when you've watched, read or eaten it, and let "Pick for me" choose tonight's
movie. Forgetless is an installable PWA that works offline: your lists stay readable without a connection, and
anything you add offline syncs when you're back. You can host it yourself as one Docker container with one
SQLite file. [docs/PRD.md](docs/PRD.md) has the product plan.

## Screenshots

| Landing | Quick capture (TMDB) | Duplicate warning | Item detail |
|---|---|---|---|
| ![](docs/screenshots/landing.png) | ![](docs/screenshots/capture-tmdb.png) | ![](docs/screenshots/capture-dup.png) | ![](docs/screenshots/detail.png) |

| Demo on mobile | Pick for me | Poster grid, dark mode |
|---|---|---|
| ![](docs/screenshots/demo-mobile.png) | ![](docs/screenshots/pick-mobile.png) | ![](docs/screenshots/watch-dark.png) |

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

### Places (Eat, Visit and Drink autocomplete)

New accounts get **Eat**, **Visit** and **Drink** lists linked to places from
[OpenStreetMap](https://www.openstreetmap.org/). It needs no key and is on by default. Existing lists keep their
setting; pick **Places (OpenStreetMap)** under **Settings → Lists → Database** to turn it on for a list.

- Search goes to [Photon](https://photon.komoot.io/) (komoot's search-as-you-type geocoder). Nominatim isn't
  used for search because its usage policy forbids autocomplete.
- When you pick a place, the server builds its details (address, cuisine, opening hours, website, phone,
  coordinates) from the search result plus one optional Nominatim `/lookup` call, and caches them for 30 days.
  If Nominatim fails or is busy, the details come from the search result alone.
- The server is polite to the public servers: searches are cached, rate-limited per user and per IP, and
  throttled for the whole instance (at most 5 Photon requests and 1 Nominatim request per second). Nominatim
  calls carry a `Forgetless/<version>` User-Agent; set `APP_CONTACT_EMAIL` so the operators can reach you.
- **Near me** in quick capture is off until you turn it on. It then asks the browser for your location once and
  sends it rounded to about 1 km, only with place searches.
- Place pages show a small map made of 9 tiles from `tile.openstreetmap.org` (cached by the service worker),
  plus links to OpenStreetMap and to directions.
- OpenStreetMap data is licensed under the [ODbL](https://www.openstreetmap.org/copyright). The app shows
  "© OpenStreetMap contributors" under place results, on place pages and on the map; keep it if you change the UI.

For a busy or private instance, run your own Photon (see the
[Photon README](https://github.com/komoot/photon#installation): one Java process plus a downloaded country or
planet index) and point `PHOTON_URL` at it. Do the same for Nominatim with `NOMINATIM_URL`, or set it to `off`.
Set `APP_PLACES_ENABLED=false` to turn places off entirely.

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
| `APP_PLACES_ENABLED` | `true` | Places autocomplete (OpenStreetMap) for Eat, Visit and Drink. |
| `PHOTON_URL` | `https://photon.komoot.io` | Photon server used for place search. Point it at your own for heavy use. |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Nominatim server for place details (`/lookup`, max 1 req/s). `off` skips it. |
| `APP_CONTACT_EMAIL` | _(empty)_ | Contact sent to Nominatim in the User-Agent and `email` parameter, as its usage policy asks. |
| `APP_MAP_TILES_URL` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Map tiles on place pages. `off` hides the map. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | _(empty)_ | Google OAuth. It's enabled only when both are set. Redirect URI: `<APP_ORIGIN>/api/auth/callback/google`. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | _(empty)_ | GitHub OAuth. It's enabled only when both are set. Callback URL: `<APP_ORIGIN>/api/auth/callback/github`. |
| `SMTP_URL` | _(empty)_ | SMTP connection URL for password-reset emails, e.g. `smtps://user:pass@smtp.example.com:465`. Without it, use the admin CLI. |
| `SMTP_FROM` | _(empty)_ | From address for those emails. |
| `PORT` | `3000` | HTTP port (adapter-node). |
| `BODY_SIZE_LIMIT` | `512K` (Docker: `21M`) | Maximum request body size (adapter-node). It's raised in the image so JSON imports and 20 MB app-import uploads fit. Set it yourself when running `node build` outside Docker. |
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

## Importing your data

Open **Import** (from Settings → Your data, or from an empty list). Pick the app, upload its export, check the
preview, choose the list to add to, and start the import. It runs on the server; the page shows progress and
you can leave while it runs. Uploads can be up to 20 MB (outside Docker, set `BODY_SIZE_LIMIT=21M`).

| App | How to export | What you get |
|---|---|---|
| Letterboxd | letterboxd.com → Settings → Import & Export → **Export your data**. Upload the ZIP as is (or any of `watchlist.csv`, `watched.csv`, `diary.csv`, `ratings.csv`, `reviews.csv`). | Watchlist → Want, watched → Done. Each diary entry becomes a log entry (date, rating, rewatch, tags, review). `ratings.csv` adds a rating only for films with no diary entry. Films that appear in several files become one item. |
| IMDb | imdb.com → Your ratings, or Your watchlist / any list → ⋯ → **Export**. Upload one or more CSVs. | Rated titles → Done with a log entry (your 1–10 rating). List entries → Want, with the list description as "why". |
| Goodreads | goodreads.com → My Books → Import and export → **Export Library** (`goodreads_library_export.csv`). | to-read → Want, currently-reading → In progress, read → Done, shelves named like "did-not-finish" → Dropped. Other shelves become tags. Rating, date read and review become a log entry. Author goes into the list's Author field (added if missing), ISBN into the item. |

Ratings are converted to the app's 1–10 scale (Letterboxd and Goodreads stars × 2).

When TMDB is configured, films and shows are matched to it: IMDb rows by their IMDb id, Letterboxd rows by
title and year (±1). Rows without a confident match are saved as custom items marked "needs match". The summary
links to them (the list's **Needs a match** filter), and you can link each one from its page. Without a TMDB key
everything is imported as custom items marked "needs match".

Items already on the target list (same TMDB entry, same source link, or the same title) are skipped by default.
Choose "Add their log entries to the existing items" to merge instead. Re-importing the same export doesn't
create duplicate items or log entries.

To restore a Forgetless JSON export, use Settings → Your data → Import.

### Catalogs

A catalog is your own list (CSV or JSON) used as autocomplete for one list, for example a board-game list for
"Board games" or a wine list for "Drink". In Settings, open a list's **Catalogs**, upload the file, pick which
columns hold the title, subtitle, year, image URL and id, and choose what to do with the other columns (ignore,
or copy into a field on the item). Quick capture then shows matching rows under "From your catalogs". Picking
one saves an item linked to that row, with the mapped fields filled in. CSVs can use `,`, `;` or tab; JSON must
be an array of objects. Catalogs are private to your account and need a connection to search.

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

Place data and map tiles © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under
the Open Database License. Place search by [Photon](https://photon.komoot.io/) (komoot).

<a href="https://www.themoviedb.org/"><img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="TMDB logo" height="16"></a>
