import { expect, test } from '@playwright/test';

// Placeholder smoke test: the app boots and the PWA plumbing is served.
// Extend with real flows (demo sign-in, quick capture, offline add) once the UI lands.

test('home page loads', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const res = await page.goto('/');
	expect(res?.ok()).toBe(true);
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
		'href',
		'/manifest.webmanifest'
	);
	expect(errors).toEqual([]);
});

test('web app manifest is served', async ({ request }) => {
	const res = await request.get('/manifest.webmanifest');
	expect(res.ok()).toBe(true);
	const manifest = await res.json();
	expect(manifest.id).toBe('/app');
	expect(manifest.display).toBe('standalone');
	expect(manifest.start_url).toBe('/');
	const sizes = manifest.icons.map(
		(i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose}`
	);
	expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
});

test('service worker is served', async ({ request }) => {
	const res = await request.get('/sw.js');
	expect(res.ok()).toBe(true);
	expect(res.headers()['content-type']).toContain('javascript');
});

test('app shell opens offline after first visit', async ({ page, context }) => {
	await page.goto('/');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	// Make sure the page is controlled before going offline.
	await page.reload();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	await context.setOffline(true);
	const res = await page.goto('/some/deep/route');
	expect(res?.status()).toBe(200);
	await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
	await context.setOffline(false);
});
