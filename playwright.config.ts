import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

// Use a pre-installed Chromium when the bundled one isn't downloaded (e.g. sandboxes, some CI images):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: ORIGIN,
		trace: 'retain-on-failure',
		launchOptions: executablePath ? { executablePath } : {}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm run build && node server.js',
		port: PORT,
		timeout: 180_000,
		reuseExistingServer: !process.env.CI,
		env: {
			PORT: String(PORT),
			ORIGIN,
			APP_ORIGIN: ORIGIN,
			APP_DB_PATH: './data/e2e.db',
			APP_DEMO_ENABLED: 'true',
			APP_ALLOW_SIGNUP: 'true',
			APP_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
			// Every e2e request shares one Better Auth rate-limit bucket (no client IP), so allow more sign-ups.
			APP_AUTH_RATE_LIMIT_MAX: '1000'
		}
	}
});
