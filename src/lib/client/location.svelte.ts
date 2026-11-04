// "Near me" for place search. Off by default; when the user turns it on we ask the browser for a position
// once per session (reusing a recent fix) and only send it, rounded to ~1 km, with place searches.
// The choice is remembered in localStorage; the position itself is kept only in memory.
import type { LatLon } from '../shared/places';

const KEY = 'app:placesNearMe';

function readPref(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}
function writePref(on: boolean) {
	try {
		if (on) localStorage.setItem(KEY, '1');
		else localStorage.removeItem(KEY);
	} catch {
		/* storage unavailable */
	}
}

export const nearMe = $state({
	enabled: typeof localStorage === 'undefined' ? false : readPref(),
	status: 'idle' as 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable',
	pos: null as LatLon | null
});

let pending: Promise<void> | null = null;

/** Asks for the position if "Near me" is on and we don't have one yet. Never throws. */
export function ensurePosition(): Promise<void> {
	if (!nearMe.enabled || nearMe.pos || pending) return pending ?? Promise.resolve();
	if (typeof navigator === 'undefined' || !navigator.geolocation) {
		nearMe.status = 'unavailable';
		return Promise.resolve();
	}
	nearMe.status = 'locating';
	pending = new Promise<void>((resolve) => {
		navigator.geolocation.getCurrentPosition(
			(p) => {
				nearMe.pos = {
					lat: Math.round(p.coords.latitude * 100) / 100,
					lon: Math.round(p.coords.longitude * 100) / 100
				};
				nearMe.status = 'ready';
				resolve();
			},
			(err) => {
				nearMe.status = err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable';
				if (err.code === err.PERMISSION_DENIED) {
					nearMe.enabled = false;
					writePref(false);
				}
				resolve();
			},
			{ enableHighAccuracy: false, maximumAge: 15 * 60 * 1000, timeout: 10_000 }
		);
	}).finally(() => {
		pending = null;
	});
	return pending;
}

export function setNearMe(on: boolean) {
	nearMe.enabled = on;
	writePref(on);
	if (on) {
		if (nearMe.status === 'denied') nearMe.status = 'idle';
		void ensurePosition();
	} else {
		nearMe.pos = null;
		nearMe.status = 'idle';
	}
}

/** The bias to send with a place search, if any. */
export const nearMePos = (): LatLon | null => (nearMe.enabled ? nearMe.pos : null);
