import { describe, it, expect } from 'vitest';
import { TokenBucket, rateLimit } from '../../src/lib/server/ratelimit';
import { LruCache } from '../../src/lib/server/lru';

describe('TokenBucket', () => {
	it('allows capacity requests then refills over the window', () => {
		let now = 0;
		const b = new TokenBucket(3, 60_000, () => now);
		expect([1, 2, 3].map(() => b.take('u').ok)).toEqual([true, true, true]);
		const denied = b.take('u');
		expect(denied.ok).toBe(false);
		expect(denied.retryAfter).toBe(20);
		expect(b.take('other').ok).toBe(true); // keys are independent
		now += 20_000;
		expect(b.take('u').ok).toBe(true);
		expect(b.take('u').ok).toBe(false);
		now += 10 * 60_000;
		expect([1, 2, 3, 4].map(() => b.take('u').ok)).toEqual([true, true, true, false]); // capped at capacity
	});

	it('rateLimit returns a 429 JSON response when exhausted', async () => {
		const b = new TokenBucket(1, 1000, () => 0);
		expect(rateLimit([b, 'k'])).toBeNull();
		const res = rateLimit([b, 'k'])!;
		expect(res.status).toBe(429);
		expect(res.headers.get('retry-after')).toBe('1');
		expect(await res.json()).toMatchObject({ message: expect.any(String), retryAfter: 1 });
	});
});

describe('LruCache', () => {
	it('evicts least recently used and expires by TTL', () => {
		let now = 0;
		const c = new LruCache<number>(2, 100, () => now);
		c.set('a', 1);
		c.set('b', 2);
		c.get('a');
		c.set('c', 3);
		expect(c.get('b')).toBeUndefined();
		expect(c.get('a')).toBe(1);
		now = 200;
		expect(c.get('a')).toBeUndefined();
	});
});
