import adapter from '@sveltejs/adapter-node';
import { withPwa } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

// PWA notes (see README "PWA / offline"):
// - @vite-pwa/sveltekit v2 is the official SvelteKit 3 integration for vite-plugin-pwa (Workbox). It wraps
//   `sveltekit()` and the adapter so the service worker is generated from `.svelte-kit/output/client` right
//   before adapter-node copies the client output into `build/client`.
// - The app is a client-rendered SPA (root layout `ssr = false`) served by adapter-node, so there is no
//   prerendered fallback page. `kit.spa` adds the server-rendered shell at `/` to the precache (revisioned
//   per build); src/sw.ts serves navigations network-first with that precached shell as offline fallback.
// - Nothing under /api/** is cached by the service worker (the app's offline data lives in IndexedDB).
//   Only TMDB poster images are runtime-cached (CacheFirst, bounded). See src/sw.ts.
const THEME_COLOR = '#b23a1e';

// Public origin of the app, baked in at BUILD time. adapter-node 6 (SvelteKit 3) no longer reads an `ORIGIN`
// env var: without `paths.origin` it derives the URL from the Host header and assumes https, which breaks
// plain-http installs (Better Auth's /api/auth/* routing compares origins, and Kit's CSRF check rejects
// form/no-body POSTs). The Dockerfile passes APP_ORIGIN as a build arg; keep it equal to the runtime
// APP_ORIGIN (src/lib/server/env.ts uses the same default).
const APP_ORIGIN = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin;

export default defineConfig({
	plugins: [
		withPwa(
			{
				compilerOptions: {
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter(),
				// Absolute /_app/... URLs: the SW serves the shell precached at "/" for every route
				// (e.g. /items/123) when offline, so asset URLs in it must not be relative.
				paths: { relative: false, origin: APP_ORIGIN }
			},
			{
				strategies: 'buildSW',
				registerType: 'autoUpdate',
				// Registration is done by a tiny inline script in src/app.html (no index.html to inject into).
				injectRegister: false,
				filename: 'sw.js',
				manifestFilename: 'manifest.webmanifest',
				kit: { spa: true, adapterFallback: '/' },
				manifest: {
					// Neutral and stable on purpose (PRD §11): renaming the app must not change the PWA identity.
					id: '/app',
					name: 'Forgetless',
					short_name: 'Forgetless',
					description:
						'Save the shows, books, restaurants and places people tell you to try, and who told you.',
					start_url: '/',
					scope: '/',
					display: 'standalone',
					orientation: 'any',
					theme_color: THEME_COLOR,
					background_color: '#f4f0e8',
					categories: ['productivity', 'lifestyle', 'entertainment'],
					icons: [
						{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
						{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
						{
							src: '/icons/maskable-512.png',
							sizes: '512x512',
							type: 'image/png',
							purpose: 'maskable'
						}
					]
				},
				buildSW: {
					// Our own worker (src/sw.ts): generateSW in @vite-pwa/workbox-build v8 silently drops
					// `expiration` / `cacheableResponse` / `precacheFallback` runtimeCaching options, so the
					// caching policy is written explicitly with workbox-swkit instead.
					swSrc: 'src/sw.ts',
					// The integration always adds a prerendered/** pattern; this app prerenders nothing.
					globStrict: false,
					globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff2,webmanifest}']
				},
				devOptions: { enabled: false }
			}
		)
	],
	// Client bundle: the app's own shared modules and its core libraries go into two chunks instead of
	// ~25 small ones, so the first load needs far fewer round-trips (Lighthouse mobile: 94 -> 96+).
	environments: {
		client: {
			build: {
				rolldownOptions: {
					output: {
						codeSplitting: {
							groups: [
								{
									name: 'vendor',
									test: /node_modules[\\/](svelte|dexie|better-auth|@better-auth|nanostores|@better-fetch|esm-env|clsx|devalue)[\\/]/,
									priority: 2
								},
								{
									name: 'app',
									test: /src[\\/]lib[\\/](client|shared|components[\\/][A-Z])/,
									priority: 1
								}
							]
						}
					}
				}
			}
		}
	},
	server: { port: 3000 },
	preview: { port: 3000 },
	ssr: { external: ['better-sqlite3'] }
});
