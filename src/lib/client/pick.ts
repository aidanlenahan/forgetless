// "Pick for me": weighted random choice from the current filtered set, biased toward older items.
// Pure functions (no DOM/Dexie) so they can be unit-tested.

export const DAY_MS = 86_400_000;

/** Weight of an item: 1 + its age in days (so a 30-day-old item is ~31x as likely as one added today). */
export function pickWeight(createdAt: number, now: number = Date.now()): number {
	const ageDays = Math.max(0, (now - createdAt) / DAY_MS);
	return 1 + ageDays;
}

export interface PickOptions {
	now?: number;
	/** Returns a float in [0, 1). Defaults to Math.random. */
	random?: () => number;
	/** Avoid returning this id (used by Re-roll) unless it is the only candidate. */
	excludeId?: string | null;
}

/** Weighted random pick. Returns null for an empty list. */
export function pickWeighted<T extends { id: string; createdAt: number }>(
	items: readonly T[],
	opts: PickOptions = {}
): T | null {
	const now = opts.now ?? Date.now();
	const random = opts.random ?? Math.random;
	let pool = items;
	if (opts.excludeId && items.length > 1) pool = items.filter((i) => i.id !== opts.excludeId);
	if (!pool.length) return null;
	const weights = pool.map((i) => pickWeight(i.createdAt, now));
	const total = weights.reduce((a, b) => a + b, 0);
	let r = random() * total;
	for (let i = 0; i < pool.length; i++) {
		r -= weights[i];
		if (r < 0) return pool[i];
	}
	return pool[pool.length - 1];
}
