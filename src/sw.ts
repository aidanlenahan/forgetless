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
// - Map tiles (place pages): CacheFirst, small and bounded.
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

// Map tiles on place pages (tile.openstreetmap.org or APP_MAP_TILES_URL): CacheFirst, small and short-lived,
// so revisiting a place doesn't refetch its 9 tiles (OSM tile usage policy asks clients to cache).
registerRoute(
	({ url, request }) =>
		request.destination === 'image' &&
		url.origin !== self.location.origin &&
		/\/\d{1,2}\/\d+\/\d+(?:@2x)?\.(?:png|jpe?g|webp)$/.test(url.pathname),
	new CacheFirst({
		cacheName: 'map-tiles',
		plugins: [
			// <img> tiles are opaque (no CORS needed from custom tile servers), and opaque entries are
			// padded heavily against storage quota, so keep the cache small: ~6 places' worth.
			new CacheableResponsePlugin({ statuses: [0, 200] }),
			new ExpirationPlugin({
				maxEntries: 60,
				maxAgeSeconds: 60 * 60 * 24 * 14,
				purgeOnQuotaError: true
			})
		]
	})
);

// ---------- Web Push (Phase 3 notifications) ----------
// The server sends a JSON PushPayload (src/lib/shared/notifications.ts). Resurface reminders carry
// Keep / Snooze / Drop buttons whose URLs are signed action links (/a/<token>): pressing one POSTs to it
// without opening the app; if that fails (offline, expired), the link is opened so the user sees why.
interface PushAction {
	action: string;
	title: string;
	url: string;
}
interface PushData {
	title?: string;
	body?: string;
	kind?: string;
	tag?: string;
	url?: string;
	actions?: PushAction[];
}

self.addEventListener('push', (event) => {
	let data: PushData;
	try {
		data = event.data?.json() ?? {};
	} catch {
		data = { body: event.data?.text() };
	}
	const actions = data.actions ?? [];
	event.waitUntil(
		self.registration.showNotification(data.title || 'Forgetless', {
			body: data.body ?? '',
			icon: '/icons/icon-192.png',
			badge: '/icons/favicon-32.png',
			tag: data.tag || data.kind || 'forgetless',
			data: { url: data.url || '/', actions },
			// `actions` is in the spec but missing from TS's lib.dom NotificationOptions.
			...({ actions: actions.map(({ action, title }) => ({ action, title })) } as object)
		})
	);
});

async function openOrFocus(url: string) {
	const target = new URL(url, self.location.origin);
	const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	for (const c of all) {
		if (new URL(c.url).origin === target.origin && 'focus' in c) {
			await c.focus();
			if (c.url !== target.href && 'navigate' in c) await c.navigate(target.href).catch(() => {});
			return;
		}
	}
	await self.clients.openWindow(target.href);
}

self.addEventListener('notificationclick', (event) => {
	const n = event.notification;
	const data = (n.data ?? {}) as { url?: string; actions?: PushAction[] };
	n.close();
	const act = event.action ? data.actions?.find((a) => a.action === event.action) : undefined;
	event.waitUntil(
		(async () => {
			if (!act) return openOrFocus(data.url || '/');
			try {
				const r = await fetch(act.url, { method: 'POST', credentials: 'omit' });
				if (!r.ok) throw new Error(String(r.status));
			} catch {
				await openOrFocus(act.url);
			}
		})()
	);
});
