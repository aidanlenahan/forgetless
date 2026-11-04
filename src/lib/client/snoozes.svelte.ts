// Active "Snooze 1 month" snoozes (set from notification action links). Server-only state, fetched on
// demand; offline it simply shows nothing.
export const snoozes = $state({ byItem: {} as Record<string, number>, loadedAt: 0 });

export async function refreshSnoozes(maxAgeMs = 60_000) {
	if (Date.now() - snoozes.loadedAt < maxAgeMs) return;
	snoozes.loadedAt = Date.now();
	try {
		const r = await fetch('/api/notifications/snoozes');
		if (!r.ok) return;
		const { snoozes: list } = (await r.json()) as { snoozes: { itemId: string; until: number }[] };
		snoozes.byItem = Object.fromEntries(list.map((s) => [s.itemId, s.until]));
	} catch {
		/* offline */
	}
}
