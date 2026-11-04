let last = 0;
/** Strictly increasing ms timestamp (process-wide). Used for sync cursors. */
export function monotonicNow(): number {
	const n = Date.now();
	last = n > last ? n : last + 1;
	return last;
}
