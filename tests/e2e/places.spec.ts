import { expect, test, type Page } from '@playwright/test';

// Places provider (OpenStreetMap). The provider endpoints and map tiles are stubbed with page.route, so CI
// never calls the public Photon / Nominatim / tile servers.

// A demo guest (not a signup): Better Auth rate-limits signups, and the other specs already use several.
async function startDemo(page: Page) {
	await page.goto('/');
	await page.getByTestId('demo-button').click();
	await expect(page.getByTestId('item-card').first()).toBeVisible({ timeout: 15_000 });
}

// A made-up place: this is a stub response, not real OSM data.
const HIT = {
	source: 'osm',
	externalId: 'node:4242',
	kind: 'restaurant',
	title: 'Noodle Lab',
	subtitle: 'Restaurant · Manhattan, New York',
	year: null,
	imageUrl: null
};

const ENTRY = {
	id: '01900000-0000-7000-8000-00000000ca75',
	source: 'osm',
	externalId: 'node:4242',
	kind: 'restaurant',
	title: 'Noodle Lab',
	subtitle: 'Ramen · Manhattan, New York',
	year: null,
	imageUrl: null,
	fetchedAt: Date.now(),
	data: {
		lat: 40.7223431,
		lon: -73.987353,
		osm_type: 'node',
		osm_id: '4242',
		osm_key: 'amenity',
		osm_value: 'restaurant',
		type_label: 'Restaurant',
		cuisine: 'Ramen',
		formatted_address: '12 Example Street, Manhattan, New York 10002, United States',
		website: 'https://noodlelab.example/',
		phone: '+1-212-555-0100',
		opening_hours: 'Mo-Th 08:00-22:15; Fr 08:00-24:00',
		osm_url: 'https://www.openstreetmap.org/node/4242'
	}
};

// 1×1 transparent PNG
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);

test('capture a place into Eat and see its address and map', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const searches: URL[] = [];
	let selected: unknown = null;
	await page.route('**/api/providers/osm/search**', async (route) => {
		const url = new URL(route.request().url());
		searches.push(url);
		await route.fulfill({ json: { hits: url.searchParams.get('q')?.length ? [HIT] : [] } });
	});
	await page.route('**/api/providers/osm/select', async (route) => {
		selected = route.request().postDataJSON();
		await route.fulfill({ json: { entry: ENTRY } });
	});
	await page.route(/tile\.openstreetmap\.org/, (route) =>
		route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
	);

	await startDemo(page);
	await page.getByTestId('capture-open').click();
	await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Eat/ }).click();
	await page.getByTestId('capture-input').fill('noodle lab');

	const result = page.getByTestId('capture-result-provider');
	await expect(result).toContainText('Noodle Lab');
	await expect(result).toContainText('Restaurant · Manhattan, New York');
	await expect(page.getByTestId('provider-group')).toContainText('Places');
	await expect(page.getByTestId('near-me')).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByTestId('osm-attribution')).toContainText('© OpenStreetMap contributors');
	expect(searches.at(-1)?.searchParams.get('prefer')).toBe('eat');
	// "Near me" is off by default, so no location is sent.
	expect(searches.at(-1)?.searchParams.has('lat')).toBe(false);

	await result.click();
	expect(selected).toEqual({ externalId: 'node:4242', kind: 'restaurant' });
	await page.getByTestId('capture-save').click();

	await page.getByTestId('item-card').filter({ hasText: 'Noodle Lab' }).first().click();
	await expect(page.getByTestId('place-address')).toHaveText(
		'12 Example Street, Manhattan, New York 10002, United States'
	);
	const info = page.getByTestId('place-info');
	await expect(info).toContainText('Ramen');
	await expect(info).toContainText('Mo-Th 08:00–22:15');
	await expect(info.getByRole('link', { name: /Open in OpenStreetMap/ })).toHaveAttribute(
		'href',
		'https://www.openstreetmap.org/node/4242'
	);
	await expect(page.getByTestId('place-directions')).toHaveAttribute(
		'href',
		/directions\?to=40\.7223431%2C-73\.987353/
	);
	await expect(page.getByTestId('place-map')).toBeVisible();
	await expect(page.getByTestId('place-map').locator('img')).toHaveCount(9);
	await expect(info).toContainText('© OpenStreetMap contributors');
	expect(errors).toEqual([]);
});
