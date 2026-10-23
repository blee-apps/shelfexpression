// Vercel function: GET /api/cover?src=<https image url>
import { coverHandler } from '../server/lookup.js';
export const GET = coverHandler;
