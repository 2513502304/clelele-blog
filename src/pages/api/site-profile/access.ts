import type { APIRoute } from 'astro';
import { isSiteAdmin } from '../../../lib/site-admin-auth';
export const prerender = false;
export const GET: APIRoute = ({ cookies }) =>
  new Response(null, { status: isSiteAdmin(cookies) ? 204 : 404, headers: { 'Cache-Control': 'private, no-store' } });
