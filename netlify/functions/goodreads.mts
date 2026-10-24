// Netlify function: GET /api/goodreads?isbn=..&title=..&author=.. (same as api/goodreads.ts on Vercel)
import { goodreadsHandler } from '../../server/lookup.js';
export default goodreadsHandler;
export const config = { path: '/api/goodreads' };
