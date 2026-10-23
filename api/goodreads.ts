// Vercel function: GET /api/goodreads?isbn=..&title=..&author=..
import { goodreadsHandler } from '../server/lookup.js';
export const GET = goodreadsHandler;
