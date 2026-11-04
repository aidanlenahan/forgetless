// Simple in-memory token buckets (single-process app). Better Auth rate-limits /api/auth itself.
import type { RequestEvent } from '@sveltejs/kit';

export interface TakeResult {
	ok: boolean;
	remaining: number;
	/** seconds until one token is available (0 when ok) */
	retryAfter: number;
}

export class TokenBucket {
	private buckets = new Map<string, { tokens: number; at: number }>();
	private readonly refillPerMs: number;

	/** `capacity` requests per `windowMs`, refilled continuously. */
	constructor(
		public readonly capacity: number,
		public readonly windowMs: number,
		private now: () => number = Date.now,
		private maxKeys = 10_000
	) {
		this.refillPerMs = capacity / windowMs;
	}

	take(key: string, cost = 1): TakeResult {
		const t = this.now();
		const b = this.buckets.get(key) ?? { tokens: this.capacity, at: t };
		b.tokens = Math.min(this.capacity, b.tokens + (t - b.at) * this.refillPerMs);
		b.at = t;
		this.buckets.delete(key); // keep Map order ~ recency so eviction drops idle keys
		this.buckets.set(key, b);
		if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value as string);
		if (b.tokens >= cost) {
			b.tokens -= cost;
			return { ok: true, remaining: Math.floor(b.tokens), retryAfter: 0 };
		}
		return { ok: false, remaining: 0, retryAfter: Math.ceil((cost - b.tokens) / this.refillPerMs / 1000) };
	}

	reset() {
		this.buckets.clear();
	}
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const g = globalThis as unknown as { __appLimits?: ReturnType<typeof makeLimits> };
const makeLimits = () => ({
	providerSearchUser: new TokenBucket(60, MIN),
	providerSearchIp: new TokenBucket(180, MIN),
	providerSelectUser: new TokenBucket(60, MIN),
	syncWriteUser: new TokenBucket(120, MIN),
	importUser: new TokenBucket(10, HOUR),
	demoIp: new TokenBucket(10, HOUR)
});
export const limits = (g.__appLimits ??= makeLimits());

export function clientIp(event: Pick<RequestEvent, 'getClientAddress'>): string {
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}

/**
 * Takes one token from each [bucket, key] pair. Returns a 429 JSON Response if any is exhausted,
 * otherwise null. Usage: `const limited = rateLimit([limits.syncWriteUser, user.id]); if (limited) return limited;`
 */
export function rateLimit(...checks: [TokenBucket, string][]): Response | null {
	for (const [bucket, key] of checks) {
		const r = bucket.take(key);
		if (!r.ok) {
			return new Response(JSON.stringify({ message: 'Too many requests, slow down.', retryAfter: r.retryAfter }), {
				status: 429,
				headers: { 'content-type': 'application/json', 'retry-after': String(r.retryAfter) }
			});
		}
	}
	return null;
}
