import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { getDb, schema } from './db';
import { env } from './env';

function createAuth() {
	const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
	if (env.google) socialProviders.google = env.google;
	if (env.github) socialProviders.github = env.github;

	return betterAuth({
		baseURL: env.origin,
		secret: env.authSecret,
		trustedOrigins: [env.origin],
		database: drizzleAdapter(getDb(), {
			provider: 'sqlite',
			schema: {
				user: schema.user,
				session: schema.session,
				account: schema.account,
				verification: schema.verification
			}
		}),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 8,
			sendResetPassword: env.smtpUrl
				? async ({ user, url }) => {
						const { sendPasswordReset } = await import('./mail');
						await sendPasswordReset(user.email, url);
					}
				: undefined
		},
		socialProviders,
		user: {
			additionalFields: {
				isGuest: { type: 'boolean', required: false, defaultValue: false, input: false },
				guestExpiresAt: { type: 'date', required: false, input: false }
			}
		},
		session: { expiresIn: 60 * 60 * 24 * 60, updateAge: 60 * 60 * 24 },
		rateLimit: env.authRateLimitMax
			? {
					enabled: true,
					window: 60,
					max: env.authRateLimitMax,
					// Better Auth's built-in, stricter sign-up/sign-in rules are raised too.
					customRules: {
						'/sign-up/email': { window: 10, max: env.authRateLimitMax },
						'/sign-in/email': { window: 10, max: env.authRateLimitMax }
					}
				}
			: { enabled: true, window: 60, max: 30 },
		databaseHooks: {
			user: {
				create: {
					after: async (u) => {
						const { seedDefaultCategories } = await import('./seed');
						seedDefaultCategories(u.id);
					}
				}
			}
		},
		plugins: [sveltekitCookies(getRequestEvent)]
	});
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __appAuth?: Auth };
export function getAuth(): Auth {
	if (!g.__appAuth) g.__appAuth = createAuth();
	return g.__appAuth;
}
