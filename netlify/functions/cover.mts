// Netlify function: GET /api/cover?src=<https image url> (same as api/cover.ts on Vercel)
import { coverHandler } from '../../server/lookup.js';
export default coverHandler;
export const config = { path: '/api/cover' };
