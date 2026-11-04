// Session + server config. Caches the last known user in localStorage so the app opens offline.
import { authClient } from './auth-client';
import { deleteLocalDb, localDb, openLocalDb } from './db';
import { startSync } from './sync';
import { startStore, stopStore } from './store.svelte';

export interface AppUser {
	id: string;
	email: string;
	name: string;
	image?: string | null;
	isGuest?: boolean | null;
	guestExpiresAt?: string | number | null;
	createdAt?: string | number | null;
}
/** Mirrors server publicConfig() (src/lib/server/env.ts). */
export interface ClientConfig {
	allowSignup: boolean;
	demoEnabled: boolean;
	oauth: { google: boolean; github: boolean };
	providers: { tmdb: boolean };
	passwordResetEmail: boolean;
}

const USER_KEY = 'app:lastUser';
const CONFIG_KEY = 'app:config';

const defaultConfig: ClientConfig = {
	allowSignup: true,
	demoEnabled: false,
	oauth: { google: false, github: false },
	providers: { tmdb: false },
	passwordResetEmail: false
};

function readLS<T>(key: string): T | null {
	try {
		const v = localStorage.getItem(key);
		return v ? (JSON.parse(v) as T) : null;
	} catch {
		return null;
	}
}
function writeLS(key: string, v: unknown) {
	try {
		if (v == null) localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(v));
	} catch {
		/* storage unavailable */
	}
}

export const session = $state({
	status: 'loading' as 'loading' | 'signedOut' | 'signedIn',
	user: null as AppUser | null,
	/** true when we're running on the cached user because the server was unreachable. */
	offlineSession: false,
	config: defaultConfig as ClientConfig
});

let stopSyncFn: (() => void) | null = null;

async function loadConfig() {
	const cached = readLS<ClientConfig>(CONFIG_KEY);
	if (cached) session.config = { ...defaultConfig, ...cached };
	try {
		const r = await fetch('/api/config');
		if (r.ok) {
			const c = (await r.json()) as ClientConfig;
			session.config = { ...defaultConfig, ...c };
			writeLS(CONFIG_KEY, c);
		}
	} catch {
		/* offline: keep cached */
	}
}

/** Returns the user, null if definitely signed out, or 'unreachable' when the server can't be reached. */
async function fetchUser(): Promise<AppUser | null | 'unreachable'> {
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'unreachable';
	try {
		const r = await fetch('/api/auth/get-session', {
			credentials: 'same-origin',
			headers: { accept: 'application/json' }
		});
		// Better Auth answers 200 + null when signed out; any other failure (429, 5xx, proxy) is "unknown".
		if (r.status === 401) return null;
		if (!r.ok) return 'unreachable';
		const ct = r.headers.get('content-type') ?? '';
		if (!ct.includes('json')) return 'unreachable'; // e.g. an offline fallback page from the service worker
		const body = (await r.json()) as { user?: AppUser } | null;
		return body?.user ?? null;
	} catch {
		return 'unreachable';
	}
}

function activate(user: AppUser, offline: boolean) {
	const switching = session.user?.id !== user.id || session.status !== 'signedIn';
	session.user = user;
	session.offlineSession = offline;
	writeLS(USER_KEY, user);
	if (switching) {
		openLocalDb(user.id);
		startStore();
		stopSyncFn?.();
		stopSyncFn = startSync();
	}
	session.status = 'signedIn';
}

function deactivate() {
	stopSyncFn?.();
	stopSyncFn = null;
	stopStore();
	session.user = null;
	session.offlineSession = false;
	session.status = 'signedOut';
}

/** (Re)load config + session. Safe to call again after sign-in. */
export async function initSession() {
	const [, u] = await Promise.all([loadConfig(), fetchUser()]);
	if (u === 'unreachable') {
		const cached = readLS<AppUser>(USER_KEY);
		if (cached) activate(cached, true);
		else deactivate();
	} else if (u) {
		activate(u, false);
	} else {
		// Definitely signed out on the server. Keep the local DB (cookie may have expired) but go to login.
		writeLS(USER_KEY, null);
		deactivate();
	}
}

/** Sign out and wipe this device's local copy. */
export async function signOut() {
	const user = session.user;
	try {
		await authClient.signOut();
	} catch {
		/* offline: still wipe locally */
	}
	deactivate();
	writeLS(USER_KEY, null);
	if (user) {
		try {
			await deleteLocalDb(user.id);
		} catch (e) {
			console.warn('[session] could not delete local db', e);
		}
	}
}

export async function pendingCount(): Promise<number> {
	try {
		return await localDb().outbox.count();
	} catch {
		return 0;
	}
}
