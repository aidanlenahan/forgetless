// Admin CLI. Runs under plain Node type stripping (no build step), so it also works in the production image:
//   npm run admin -- list-users
//   npm run admin -- reset-password <email> <new-password>
//   npm run admin -- purge-guests
// Uses APP_DB_PATH (default ./data/app.db). Talks to SQLite directly; only imports dependency-free app modules.
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { hashPassword } from 'better-auth/crypto';
import { purgeExpiredGuestsSql } from '../src/lib/server/purge.ts';

const MIN_PASSWORD = 8;

function usage(code = 1): never {
	console.log(`Usage: npm run admin -- <command>

Commands:
  list-users                          List accounts (email, name, guest, created)
  reset-password <email> <password>   Set a new password (min ${MIN_PASSWORD} chars) and sign out all sessions
  purge-guests                        Delete expired demo guest accounts now

Env: APP_DB_PATH (default ./data/app.db)`);
	process.exit(code);
}

function openDb() {
	const path = process.env.APP_DB_PATH ?? './data/app.db';
	if (!existsSync(path)) {
		console.error(
			`Database not found at ${path} (set APP_DB_PATH). Start the app once to create it.`
		);
		process.exit(1);
	}
	const db = new Database(path);
	db.pragma('foreign_keys = ON');
	db.pragma('busy_timeout = 5000');
	return db;
}

async function main() {
	const [cmd, ...args] = process.argv.slice(2);
	if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') usage(cmd ? 0 : 1);

	if (cmd === 'list-users') {
		const db = openDb();
		const rows = db
			.prepare(
				`SELECT u.email, u.name, u.is_guest AS guest, u.created_at AS created,
				   (SELECT group_concat(provider_id) FROM account a WHERE a.user_id = u.id) AS providers
				 FROM user u ORDER BY u.created_at`
			)
			.all() as {
			email: string;
			name: string;
			guest: number;
			created: number;
			providers: string | null;
		}[];
		if (!rows.length) console.log('No users.');
		for (const r of rows) {
			console.log(
				[
					r.email,
					r.name,
					r.guest ? 'guest' : 'user',
					new Date(r.created).toISOString(),
					r.providers ?? ''
				].join('\t')
			);
		}
		return;
	}

	if (cmd === 'reset-password') {
		const [email, password] = args;
		if (!email || !password) usage();
		if (password.length < MIN_PASSWORD) {
			console.error(`Password must be at least ${MIN_PASSWORD} characters.`);
			process.exit(1);
		}
		const db = openDb();
		const user = db.prepare('SELECT id FROM user WHERE lower(email) = lower(?)').get(email) as
			{ id: string } | undefined;
		if (!user) {
			console.error(`No user with email ${email}`);
			process.exit(1);
		}
		const hash = await hashPassword(password);
		const now = Date.now();
		const res = db
			.prepare(
				"UPDATE account SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = 'credential'"
			)
			.run(hash, now, user.id);
		if (res.changes === 0) {
			// OAuth-only user: add a credential account so they can also sign in with a password.
			db.prepare(
				"INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, ?, ?, ?)"
			).run(crypto.randomUUID(), user.id, user.id, hash, now, now);
		}
		const s = db.prepare('DELETE FROM session WHERE user_id = ?').run(user.id);
		console.log(`Password updated for ${email}. Signed out ${s.changes} session(s).`);
		return;
	}

	if (cmd === 'purge-guests') {
		const n = purgeExpiredGuestsSql(openDb());
		console.log(`Purged ${n} expired guest account(s).`);
		return;
	}

	console.error(`Unknown command: ${cmd}\n`);
	usage();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
