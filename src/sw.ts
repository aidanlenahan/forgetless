/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Forgetless service worker. Built by @vite-pwa/sveltekit (strategy `buildSW`, see vite.config.ts), which bundles
// this file and injects the precache manifest into `self.__WB_MANIFEST`.
//
// Deliberately NOT named src/service-worker.ts so SvelteKit doesn't build/register its own worker as well.
//
// Caching policy:
// - Precache: the app shell (hashed JS/CSS under /_app/immutable, icons, manifest) plus the server-rendered
//   SPA shell at "/" (the app is client-rendered, `ssr = false`, so every page shares that HTML).
// - Navigations: network first (4 s timeout), falling back to the precached shell when offline.
// - /api/**: never cached here. Offline data lives in IndexedDB (Dexie) and the outbox handles writes.
// - TMDB poster images: CacheFirst, bounded.
import { clientsClaim } from '@vite-pwa/workbox-swkit/core';
import {
	cleanupOutdatedCaches,
	matchPrecache,
	precacheAndRoute
} from '@vite-pwa/workbox-swkit/precaching';
import { NavigationRoute, registerRoute } from '@vite-pwa/workbox-swkit/routing';
import { CacheFirst, NetworkOnly } from '@vite-pwa/workbox-swkit/strategies';
import { ExpirationPlugin } from '@vite-pwa/workbox-swkit/expiration';
import { CacheableResponsePlugin } from '@vite-pwa/workbox-swkit/cacheable-response';

declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

const SHELL_URL = '/';

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const network = new NetworkOnly({ networkTimeoutSeconds: 4 });

registerRoute(
	new NavigationRoute(
		async (options) => {
			try {
				return await network.handle(options);
			} catch {
				const shell = await matchPrecache(SHELL_URL);
				return shell ?? Response.error();
			}
		},
		// OAuth callbacks, file exports etc. must always reach the server.
		{ denylist: [/^\/api\//] }
	)
);

registerRoute(
	({ url }) => url.origin === 'https://image.tmdb.org',
	new CacheFirst({
		cacheName: 'tmdb-images',
		plugins: [
			new CacheableResponsePlugin({ statuses: [0, 200] }),
			new ExpirationPlugin({
				maxEntries: 400,
				maxAgeSeconds: 60 * 60 * 24 * 60,
				purgeOnQuotaError: true
			})
		]
	})
);
