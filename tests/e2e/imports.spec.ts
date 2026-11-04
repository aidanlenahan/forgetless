import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Phase 2 "Get data in": app imports and user catalogs.

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

// Demo guests (not sign-ups) so these tests don't add to the auth sign-up rate limit the other specs use.
async function demo(page: Page) {
	await page.goto('/');
	await page.getByTestId('demo-button').click();
	await expect(page.getByTestId('item-card').first()).toBeVisible({ timeout: 15_000 });
}

test('import a Goodreads export into Read', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await demo(page);

	await page.goto('/import');
	await page.getByTestId('import-source-goodreads').click();
	await page.getByTestId('import-file').setInputFiles(fixture('goodreads_library_export.csv'));

	const preview = page.getByTestId('import-preview');
	await expect(preview).toContainText('Found 4 items');
	await expect(page.getByTestId('import-target').locator('option:checked')).toContainText('Read');
	// The demo's Read list already has Piranesi and Tomorrow, and Tomorrow, and Tomorrow.
	await expect(preview).toContainText('2 already on Read');
	await preview.getByLabel('Add their log entries to the existing items').check();
	await page.getByTestId('import-start').click();

	await expect(page.getByTestId('import-done')).toContainText('Import finished', {
		timeout: 15_000
	});
	await expect(page.getByTestId('import-created')).toHaveText('2 new items');
	await expect(page.getByTestId('import-done')).toContainText('2 existing items updated');
	await page.getByTestId('import-open-list').click();

	await expect(
		page.getByTestId('item-card').filter({ hasText: 'The Left Hand of Darkness' })
	).toBeVisible();
	// Piranesi was "want" in the demo; the import marked it read, so it's under Done now.
	await page.getByTestId('status-filter-done').click();
	await page.getByTestId('item-card').filter({ hasText: 'Piranesi' }).click();
	await expect(page.getByLabel('Author')).toHaveValue('Susanna Clarke');
	await expect(page.getByTestId('log-entry')).toHaveCount(1);
	expect(errors).toEqual([]);
});

test('a catalog becomes an autocomplete source in quick capture', async ({ page }) => {
	await demo(page);
	await page.goto('/settings');
	// Default lists: Watch, Read, Eat, Visit, Drink, Cook
	const row = page.getByTestId('category-row').nth(4);
	await expect(row.getByRole('textbox', { name: 'List name' })).toHaveValue('Drink');
	await row.getByTestId('catalogs-toggle').click();
	await row.getByTestId('catalog-file').setInputFiles(fixture('catalog-boardgames.csv'));
	await expect(row.getByTestId('catalog-map-title')).toHaveValue('Name');
	await row.getByTestId('catalog-create').click();
	await expect(row.getByTestId('category-catalogs')).toContainText('4 rows');

	await page.goto('/');
	await page.getByTestId('capture-open').click();
	await page
		.getByRole('group', { name: 'Category' })
		.getByRole('button', { name: /Drink/ })
		.click();
	await page.getByTestId('capture-input').fill('azu');
	await page.getByTestId('capture-result-catalog').first().click();
	await page.getByTestId('capture-save').click();
	await page.getByTestId('item-card').filter({ hasText: 'Azul' }).click();
	await expect(page.getByLabel('Players')).toHaveValue('2-4'); // field added + copied from the catalog
});
