import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests run in plain Node (no SvelteKit plugin). Server modules use relative imports, so only
// the `#lib` alias is mapped (package.json "imports" also covers it) for any route-level code.
export default defineConfig({
	resolve: {
		alias: [
			{ find: /^#lib\/(.*)$/, replacement: fileURLToPath(new URL('./src/lib/$1', import.meta.url)) }
		]
	},
	test: {
		environment: 'node',
		include: ['tests/unit/**/*.test.ts'],
		env: { APP_DB_PATH: ':memory:' }
	}
});
