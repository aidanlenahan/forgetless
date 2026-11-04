import { json } from '@sveltejs/kit';
import { publicConfig } from '#lib/server/env.ts';
export const GET = () => json(publicConfig());
