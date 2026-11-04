/** Tiny in-memory LRU cache with per-entry TTL. Map iteration order = recency order. */
export class LruCache<V> {
	private map = new Map<string, { value: V; expires: number }>();
	constructor(
		private max = 500,
		private ttlMs = 10 * 60 * 1000,
		private now: () => number = Date.now
	) {}

	get(key: string): V | undefined {
		const hit = this.map.get(key);
		if (!hit) return undefined;
		if (hit.expires <= this.now()) {
			this.map.delete(key);
			return undefined;
		}
		this.map.delete(key);
		this.map.set(key, hit);
		return hit.value;
	}

	set(key: string, value: V) {
		this.map.delete(key);
		this.map.set(key, { value, expires: this.now() + this.ttlMs });
		while (this.map.size > this.max) {
			const oldest = this.map.keys().next().value as string;
			this.map.delete(oldest);
		}
	}

	get size() {
		return this.map.size;
	}

	clear() {
		this.map.clear();
	}
}
