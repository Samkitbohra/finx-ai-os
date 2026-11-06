'use server';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db, schema } from '@/db';
import { setSessionCookie } from '@/lib/auth';

export async function login(_: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };
  const u = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) return { error: 'That email and password don’t match.' };
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
  await setSessionCookie(u.id);
  redirect('/console');
}
