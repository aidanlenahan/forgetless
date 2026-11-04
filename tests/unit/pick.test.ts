import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';

const hasPick = existsSync(new URL('../../src/lib/client/pick.ts', import.meta.url));

describe.skipIf(!hasPick)('pick for me', async () => {
	const { pickWeight, pickWeighted, DAY_MS } = hasPick
		? await import('../../src/lib/client/pick')
		: ({} as typeof import('../../src/lib/client/pick'));
	const now = 1_000 * DAY_MS;
	const items = [
		{ id: 'new', createdAt: now },
		{ id: 'old', createdAt: now - 99 * DAY_MS }
	];

	it('weights older items more', () => {
		expect(pickWeight(now, now)).toBe(1);
		expect(pickWeight(now - 99 * DAY_MS, now)).toBe(100);
		expect(pickWeight(now + DAY_MS, now)).toBe(1); // future dates clamp
	});

	it('maps the random draw over cumulative weights', () => {
		expect(pickWeighted(items, { now, random: () => 0 })?.id).toBe('new');
		expect(pickWeighted(items, { now, random: () => 0.0099 })?.id).toBe('new');
		expect(pickWeighted(items, { now, random: () => 0.0100 })?.id).toBe('old');
		expect(pickWeighted(items, { now, random: () => 0.999 })?.id).toBe('old');
		expect(pickWeighted([], { now })).toBeNull();
	});

	it('is biased toward older items over many draws', () => {
		let seed = 42;
		const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
		let old = 0;
		for (let i = 0; i < 5000; i++) if (pickWeighted(items, { now, random })?.id === 'old') old++;
		expect(old / 5000).toBeGreaterThan(0.97);
	});

	it('re-roll excludes the previous pick unless it is the only one', () => {
		expect(pickWeighted(items, { now, random: () => 0.999, excludeId: 'old' })?.id).toBe('new');
		expect(pickWeighted([items[0]], { now, excludeId: 'new' })?.id).toBe('new');
	});
});
