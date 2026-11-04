// Global outbound throttle: spaces calls to an upstream at least `intervalMs` apart (process-wide), so the
// public Photon / Nominatim servers see a polite, steady request rate no matter how many users search.
// Callers that would have to wait longer than `maxWaitMs` are turned away instead of piling up.
import { ProviderError } from './types';

export class Throttle {
	private next = 0;

	constructor(
		public readonly intervalMs: number,
		public readonly maxWaitMs = 3000,
		private now: () => number = Date.now,
		private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
	) {}

	/** How long a call made now would wait for its slot. */
	waitMs(): number {
		return Math.max(0, this.next - this.now());
	}

	/** Runs `fn` in the next free slot. Throws ProviderError(503) if that slot is too far away. */
	async run<T>(fn: () => Promise<T>): Promise<T> {
		const t = this.now();
		const at = Math.max(t, this.next);
		if (at - t > this.maxWaitMs) {
			const err = new ProviderError('Place search is busy, try again in a moment', 503);
			err.retryAfter = Math.ceil((at - t) / 1000);
			throw err;
		}
		this.next = at + this.intervalMs;
		if (at > t) await this.sleep(at - t);
		return fn();
	}

	reset() {
		this.next = 0;
	}
}
