import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

export type DB = ReturnType<typeof createDb>;

export function createDb(path: string) {
	if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('busy_timeout = 5000');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: process.env.APP_MIGRATIONS_DIR ?? resolve('drizzle') });
	return Object.assign(db, { sqlite });
}

const globalForDb = globalThis as unknown as { __appDb?: DB };

/** Lazily-created process-wide DB. APP_DB_PATH defaults to ./data/app.db */
export function getDb(): DB {
	if (!globalForDb.__appDb) {
		globalForDb.__appDb = createDb(process.env.APP_DB_PATH ?? './data/app.db');
	}
	return globalForDb.__appDb;
}

export { schema };
