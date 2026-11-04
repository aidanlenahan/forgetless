// Place helpers shared by the client and tests (no browser or server dependencies).

/** OSM data is ODbL: show this wherever place results or details appear. */
export const OSM_ATTRIBUTION = {
	text: '© OpenStreetMap contributors',
	url: 'https://www.openstreetmap.org/copyright'
};

export type PlacePreference = 'eat' | 'drink' | 'visit';

/** Which kind of place a category is about, from its name or emoji (a ranking hint only). */
export function placePreference(
	c: { name: string; icon: string } | null | undefined
): PlacePreference | null {
	if (!c) return null;
	const s = `${c.name} ${c.icon}`.toLowerCase();
	const has = (words: string, emoji: string) =>
		new RegExp(`(?:^|\\P{L})(?:${words})s?(?=$|\\P{L})`, 'u').test(s) ||
		new RegExp(`[${emoji}]`, 'u').test(s);
	if (has('drink|bar|cocktail|coffee|caf[eé]|beer|wine|pub', '🍸🍺🍷☕🍹🥂')) return 'drink';
	if (has('eat|food|restaurant|brunch|lunch|dinner|pizza|ramen', '🍜🍕🍽🍔🍣🥟')) return 'eat';
	if (has('visit|see|travel|trip|place|museum|park', '📍🗺🏛✈')) return 'visit';
	return null;
}

export interface LatLon {
	lat: number;
	lon: number;
}

/** Web Mercator: fractional tile coordinates of a point at zoom `z`. */
export function tileXY(p: LatLon, z: number): { x: number; y: number } {
	const n = 2 ** z;
	const lat = Math.max(-85.05112878, Math.min(85.05112878, p.lat));
	const r = (lat * Math.PI) / 180;
	return {
		x: ((p.lon + 180) / 360) * n,
		y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
	};
}

/** Tiles of a cols x rows grid centred on `p`, each with its pixel offset from the point. */
export function tileGrid(
	p: LatLon,
	z: number,
	cols = 3,
	rows = 3,
	size = 256
): { x: number; y: number; z: number; left: number; top: number }[] {
	const n = 2 ** z;
	const t = tileXY(p, z);
	const cx = Math.floor(t.x);
	const cy = Math.floor(t.y);
	const out = [];
	for (let dy = -Math.floor(rows / 2); dy <= Math.floor(rows / 2); dy++)
		for (let dx = -Math.floor(cols / 2); dx <= Math.floor(cols / 2); dx++) {
			const y = cy + dy;
			if (y < 0 || y >= n) continue;
			const x = (((cx + dx) % n) + n) % n;
			out.push({
				x,
				y,
				z,
				left: Math.round((cx + dx - t.x) * size),
				top: Math.round((cy + dy - t.y) * size)
			});
		}
	return out;
}

export function tileUrl(template: string, t: { x: number; y: number; z: number }): string {
	return template
		.replace('{z}', String(t.z))
		.replace('{x}', String(t.x))
		.replace('{y}', String(t.y))
		.replace('{s}', 'a');
}

/** Place data stored in catalog_entries.data by the osm provider. */
export interface PlaceData {
	lat: number | null;
	lon: number | null;
	type_label: string | null;
	cuisine: string | null;
	formatted_address: string | null;
	website: string | null;
	phone: string | null;
	opening_hours: string | null;
	osm_url: string | null;
}

export function placeData(data: Record<string, unknown> | undefined | null): PlaceData {
	const d = data ?? {};
	const s = (k: string) =>
		typeof d[k] === 'string' && (d[k] as string).trim() ? (d[k] as string) : null;
	const n = (k: string) =>
		typeof d[k] === 'number' && Number.isFinite(d[k]) ? (d[k] as number) : null;
	return {
		lat: n('lat'),
		lon: n('lon'),
		type_label: s('type_label'),
		cuisine: s('cuisine'),
		formatted_address: s('formatted_address'),
		website: s('website'),
		phone: s('phone'),
		opening_hours: s('opening_hours'),
		osm_url: s('osm_url')
	};
}

/** OSM opening_hours is terse ("Mo-Th 08:00-22:15; Fr 08:00-24:00"): one rule per line, nicer dashes. */
export function openingHoursLines(v: string | null): string[] {
	if (!v) return [];
	return v
		.split(/\s*;\s*/)
		.map((x) => x.trim().replace(/(\d)-(\d)/g, '$1–$2'))
		.filter(Boolean)
		.slice(0, 10);
}
