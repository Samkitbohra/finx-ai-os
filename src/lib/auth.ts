import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Role, Via } from '@/db/schema';
import { can, Action, Forbidden, ORG_WIDE } from './permissions';

const COOKIE = 'finx_session';
const BORROWER_COOKIE = 'finx_borrower';
// Without AUTH_SECRET, derive one from the (private) database URL so a fresh deploy is still signed securely.
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || createHash('sha256').update('finx:' + (process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || 'dev-only-secret-change-me')).digest('hex'));

export interface Ctx {
  orgId: string;
  userId: string | null;
  role: Role;
  branchId: string | null; // null = all branches
  name: string;
  via: Via;
}

export async function signSession(payload: Record<string, unknown>, ttl = '12h') {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ttl).sign(secret());
}

export async function verify<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as T;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string) {
  const token = await signSession({ uid: userId });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 12 * 3600 });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in staff member, or null. */
export async function getCtx(via: Via = 'UI'): Promise<Ctx | null> {
  const s = await verify<{ uid: string }>((await cookies()).get(COOKIE)?.value);
  if (!s) return null;
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, s.uid) });
  if (!u || !u.active) return null;
  return { orgId: u.orgId, userId: u.id, role: u.role, branchId: ORG_WIDE.includes(u.role) ? null : u.branchId, name: u.name, via };
}

export async function requireCtx(action: Action = 'read', via: Via = 'UI'): Promise<Ctx> {
  const ctx = await getCtx(via);
  if (!ctx) redirect('/login');
  if (!can(ctx.role, action)) throw new Forbidden(action);
  return ctx;
}

export function assertCan(ctx: Ctx, action: Action) {
  if (!can(ctx.role, action)) throw new Forbidden(action);
}

// ---- borrower app (phone + OTP)
export async function setBorrowerCookie(borrowerId: string) {
  const token = await signSession({ bid: borrowerId }, '30d');
  (await cookies()).set(BORROWER_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 30 * 86400 });
}
export async function getBorrowerId(): Promise<string | null> {
  const s = await verify<{ bid: string }>((await cookies()).get(BORROWER_COOKIE)?.value);
  return s?.bid ?? null;
}
export async function clearBorrower() {
  (await cookies()).delete(BORROWER_COOKIE);
}
