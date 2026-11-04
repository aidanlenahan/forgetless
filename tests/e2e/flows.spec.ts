import { expect, test, type Page } from '@playwright/test';

// End-to-end MVP flows (PRD §6 acceptance criteria).

async function signUp(page: Page) {
	const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
	await page.goto('/signup');
	await page.getByTestId('auth-email').fill(email);
	await page.getByTestId('auth-password').fill('password123');
	await page.getByTestId('auth-submit').click();
	await page.waitForURL('/');
	await expect(page.getByTestId('capture-open')).toBeVisible();
	// Default categories arrive with the first sync.
	await expect(page.getByRole('link', { name: /Watch/ }).first()).toBeVisible();
}

async function serverItems(page: Page) {
	return page.evaluate(async () => (await (await fetch('/api/sync?since=0')).json()).items);
}

test('capture a custom item, see duplicate warning, pick for me', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await signUp(page);

	await page.getByTestId('capture-open').click();
	await page.getByTestId('capture-input').fill('Sourdough focaccia');
	await page.getByTestId('capture-result-custom').click();
	await page.getByPlaceholder('Sam').fill('Priya');
	await page.getByTestId('capture-save').click();
	await expect(
		page.getByTestId('item-card').filter({ hasText: 'Sourdough focaccia' })
	).toBeVisible();

	// Duplicate warning before saving again.
	await page.keyboard.press('n');
	await page.getByTestId('capture-input').fill('sourdough');
	await expect(page.getByTestId('capture-result-own').first()).toContainText('Sourdough focaccia');
	await page.keyboard.press('Escape');

	await page.getByTestId('pick-for-me').click();
	await expect(page.getByTestId('pick-title')).toHaveText('Sourdough focaccia');

	await expect.poll(async () => (await serverItems(page)).length).toBe(1);
	expect(errors).toEqual([]);
});

test('offline capture is queued and syncs when back online', async ({ page, context }) => {
	await signUp(page);
	await context.setOffline(true);
	await page.getByTestId('capture-open').click();
	await page.getByTestId('capture-input').fill('Offline ramen spot');
	await page.getByTestId('capture-result-custom').click();
	await page.getByTestId('capture-save').click();
	await expect(
		page.getByTestId('item-card').filter({ hasText: 'Offline ramen spot' })
	).toBeVisible();
	await context.setOffline(false);
	await expect
		.poll(async () => (await serverItems(page)).map((i: { title: string }) => i.title), {
			timeout: 15_000
		})
		.toContain('Offline ramen spot');
});

test('demo guest flow shows seeded data', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('demo-button').click();
	await expect(page.getByTestId('item-card').first()).toBeVisible({ timeout: 15_000 });
	await expect(page.getByRole('strong').filter({ hasText: 'Demo account' })).toBeVisible();
});

test('multiple log entries on an item', async ({ page }) => {
	await signUp(page);
	await page.getByTestId('capture-open').click();
	await page.getByTestId('capture-input').fill('Arrival');
	await page.getByTestId('capture-result-custom').click();
	await page.getByTestId('capture-save').click();
	await page.getByTestId('item-card').filter({ hasText: 'Arrival' }).click();
	for (let i = 0; i < 2; i++) {
		await page.getByTestId('add-log').click();
		await page.getByTestId('log-save').click();
	}
	await expect(page.getByTestId('log-entry')).toHaveCount(2);
});
