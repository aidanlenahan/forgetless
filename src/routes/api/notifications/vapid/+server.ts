import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { vapidKeys } from '#lib/server/notify/push.ts';

/** GET /api/notifications/vapid → { publicKey } (the applicationServerKey for pushManager.subscribe) */
export const GET: RequestHandler = () => json({ publicKey: vapidKeys(getDb()).publicKey });
