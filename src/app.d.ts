// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			user: {
				id: string;
				email: string;
				name: string;
				image?: string | null;
				isGuest?: boolean | null;
				guestExpiresAt?: Date | null;
			} | null;
			session: { id: string; expiresAt: Date } | null;
		}
	}
}

export {};
