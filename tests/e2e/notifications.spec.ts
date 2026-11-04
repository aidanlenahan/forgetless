import { expect, test } from '@playwright/test';

// Phase 3: the Notifications section in Settings saves and reloads preferences.
test('notification settings persist across reloads', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const email = `e2e-notif-${Date.now()}@example.com`;
	await page.goto('/signup');
	await page.getByTestId('auth-email').fill(email);
	await page.getByTestId('auth-password').fill('password123');
	await page.getByTestId('auth-submit').click();
	await page.waitForURL('/');

	await page.goto('/settings#notifications');
	const section = page.getByTestId('notifications');
	await expect(section.getByRole('heading', { name: 'Notifications' })).toBeVisible();
	await expect(page.getByTestId('digest-freq')).toBeVisible();
	// The e2e server has no SMTP_URL, so email is off with an explanation.
	await expect(page.getByTestId('notif-email')).toBeDisabled();
	await expect(section).toContainText("Email isn't set up on this server");
	// Time zone comes from the browser.
	await expect(page.getByTestId('notif-tz')).not.toHaveValue('');

	await page.getByTestId('digest-freq').selectOption('weekly');
	await page.getByTestId('digest-day').selectOption('Friday');
	await page.getByTestId('digest-hour').selectOption('18');
	await page.getByTestId('resurface-enabled').check();
	await page.getByTestId('notif-save').click();
	await expect(page.getByText('Notification settings saved')).toBeVisible();

	await page.reload();
	await expect(page.getByTestId('digest-freq')).toHaveValue('weekly');
	await expect(page.getByTestId('digest-day')).toHaveValue('5');
	await expect(page.getByTestId('digest-hour')).toHaveValue('18');
	await expect(page.getByTestId('resurface-enabled')).toBeChecked();
	await expect(page.getByTestId('notif-save')).toBeDisabled();

	// Preview: a fresh account has nothing old enough to send.
	await page.getByTestId('notif-preview').locator('summary').click();
	await expect(page.getByTestId('notif-preview')).toContainText('Next:');

	const prefs = await page.evaluate(
		async () => (await (await fetch('/api/notifications/prefs')).json()).prefs
	);
	expect(prefs).toMatchObject({ digestFrequency: 'weekly', digestDayOfWeek: 5, digestHour: 18 });
	expect(errors).toEqual([]);
});

test('demo accounts see a note instead of notification settings', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('demo-button').click();
	await expect(page.getByTestId('item-card').first()).toBeVisible({ timeout: 15_000 });
	await page.goto('/settings');
	await expect(page.getByTestId('notif-guest')).toBeVisible();
	const r = await page.evaluate(async () => (await fetch('/api/notifications/prefs')).status);
	expect(r).toBe(403);
});
