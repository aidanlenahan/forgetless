// All runtime config in one place. Read from process.env so the same image works anywhere.
const e = process.env;
const bool = (v: string | undefined, d: boolean) =>
	v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(v);

export const env = {
	origin: e.APP_ORIGIN ?? e.ORIGIN ?? 'http://localhost:3000',
	authSecret:
		e.APP_AUTH_SECRET ?? e.BETTER_AUTH_SECRET ?? 'dev-insecure-secret-change-me-please-0123456789',
	dbPath: e.APP_DB_PATH ?? './data/app.db',
	allowSignup: bool(e.APP_ALLOW_SIGNUP, true),
	demoEnabled: bool(e.APP_DEMO_ENABLED, true),
	tmdbKey: e.TMDB_API_KEY || '',
	google:
		e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
			? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
			: null,
	github:
		e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET
			? { clientId: e.GITHUB_CLIENT_ID, clientSecret: e.GITHUB_CLIENT_SECRET }
			: null,
	smtpUrl: e.SMTP_URL || '',
	smtpFrom: e.SMTP_FROM || '',
	guestTtlMs: 24 * 60 * 60 * 1000,
	guestItemCap: Number(e.APP_GUEST_ITEM_CAP ?? 500)
};

/** What the client needs to know (safe to expose). */
export function publicConfig() {
	return {
		allowSignup: env.allowSignup,
		demoEnabled: env.demoEnabled,
		oauth: { google: !!env.google, github: !!env.github },
		providers: { tmdb: !!env.tmdbKey },
		passwordResetEmail: !!env.smtpUrl
	};
}
export type PublicConfig = ReturnType<typeof publicConfig>;
