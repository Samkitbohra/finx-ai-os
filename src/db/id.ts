import { randomBytes } from 'crypto';
// Short, sortable-enough, URL-safe ids (time prefix + randomness)
export function createId(): string {
  const t = Date.now().toString(36);
  const r = randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 10);
  return `${t}${r}`.toLowerCase();
}
