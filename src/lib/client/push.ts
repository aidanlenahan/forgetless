// Web Push on this device: support detection (incl. the iOS "installed PWA, 16.4+" rule) and
// subscribe / unsubscribe against /api/notifications/push/subscribe.

export type PushSupport =
	| { ok: true }
	| { ok: false; reason: 'unsupported' | 'ios-not-installed' | 'no-service-worker' | 'denied' };

export function isIos(): boolean {
	if (typeof navigator === 'undefined') return false;
	return (
		/iP(hone|ad|od)/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
}

export function isStandalone(): boolean {
	return (
		matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

export function pushSupport(): PushSupport {
	if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' };
	// iOS Safari only exposes PushManager inside an installed (Home Screen) web app, iOS 16.4+.
	if (isIos() && !isStandalone()) return { ok: false, reason: 'ios-not-installed' };
	if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
		return { ok: false, reason: 'unsupported' };
	if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
	return { ok: true };
}

/** The active service worker registration, or null (e.g. `vite dev`, where /sw.js isn't built). */
export async function swRegistration(timeoutMs = 3000): Promise<ServiceWorkerRegistration | null> {
	if (!('serviceWorker' in navigator)) return null;
	const reg = await navigator.serviceWorker.getRegistration('/');
	if (!reg) return null;
	if (reg.active) return reg;
	return Promise.race([
		navigator.serviceWorker.ready,
		new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))
	]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
	try {
		const reg = await swRegistration(500);
		return (await reg?.pushManager.getSubscription()) ?? null;
	} catch {
		return null;
	}
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
	const pad = '='.repeat((4 - (s.length % 4)) % 4);
	const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
	const out = new Uint8Array(new ArrayBuffer(bin.length));
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function errorMessage(r: Response, fallback: string) {
	const b = (await r.json().catch(() => null)) as { message?: string } | null;
	return b?.message || `${fallback} (${r.status})`;
}

/** Asks for permission (must run from a user gesture), subscribes and registers this device. */
export async function subscribePush(): Promise<PushSubscription> {
	const reg = await swRegistration();
	if (!reg)
		throw new Error(
			'The app’s service worker isn’t running. Reload the page (push needs the production build).'
		);
	const perm = await Notification.requestPermission();
	if (perm !== 'granted')
		throw new Error('Notifications are blocked for this site in your browser.');
	const r = await fetch('/api/notifications/vapid');
	if (!r.ok) throw new Error(await errorMessage(r, 'Could not load the push key'));
	const { publicKey } = (await r.json()) as { publicKey: string };
	let sub = await reg.pushManager.getSubscription();
	// A subscription made with another server key (e.g. keys rotated) must be replaced.
	const key = sub?.options.applicationServerKey;
	if (sub && key) {
		const a = new Uint8Array(key);
		const b = b64urlToBytes(publicKey);
		if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
			await sub.unsubscribe();
			sub = null;
		}
	}
	sub ??= await reg.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: b64urlToBytes(publicKey)
	});
	const save = await fetch('/api/notifications/push/subscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ subscription: sub.toJSON() })
	});
	if (!save.ok) throw new Error(await errorMessage(save, 'Could not register this device'));
	return sub;
}

/** Removes this device's subscription (server first, then the browser). */
export async function unsubscribePush(endpoint?: string): Promise<void> {
	const sub = await currentSubscription();
	const ep = endpoint ?? sub?.endpoint;
	if (ep)
		await fetch('/api/notifications/push/subscribe', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: ep })
		});
	if (sub && (!endpoint || endpoint === sub.endpoint)) await sub.unsubscribe().catch(() => {});
}

/** "Chrome on macOS" from a user agent string. */
export function deviceLabel(ua: string | null): string {
	if (!ua) return 'Unknown device';
	const browser = /Edg\//.test(ua)
		? 'Edge'
		: /Firefox\//.test(ua)
			? 'Firefox'
			: /Chrome\//.test(ua)
				? 'Chrome'
				: /Safari\//.test(ua)
					? 'Safari'
					: 'Browser';
	const os = /iPhone|iPad|iPod/.test(ua)
		? 'iOS'
		: /Android/.test(ua)
			? 'Android'
			: /Mac OS X/.test(ua)
				? 'macOS'
				: /Windows/.test(ua)
					? 'Windows'
					: /Linux/.test(ua)
						? 'Linux'
						: 'unknown OS';
	return `${browser} on ${os}`;
}
