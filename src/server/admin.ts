// Organisation settings, branches, staff, products, targets and API keys.
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Ctx } from '@/lib/auth';
import { assertCan } from '@/lib/auth';
import { UserError } from '@/lib/permissions';
import { audit } from './core';

const T = schema;
const opt = (v?: string) => (v === undefined || v === '' ? null : v);

export async function updateOrg(ctx: Ctx, f: Record<string, string>) {
  assertCan(ctx, 'settings.write');
  const before = await db.query.organizations.findFirst({ where: eq(T.organizations.id, ctx.orgId) });
  const start = Number(f.callWindowStart ?? before?.callWindowStart), end = Number(f.callWindowEnd ?? before?.callWindowEnd);
  if (start < 7 || end > 20 || start >= end) throw new UserError('Contact hours must sit between 07:00 and 20:00');
  const [after] = await db.update(T.organizations).set({
    name: f.name ?? before?.name, legalName: opt(f.legalName), licenseNo: opt(f.licenseNo), state: f.state ?? before?.state, gstin: opt(f.gstin), pan: opt(f.pan),
    address: opt(f.address), phone: opt(f.phone), email: opt(f.email), upiVpa: opt(f.upiVpa), callWindowStart: start, callWindowEnd: end,
    maxContactsPerDay: Number(f.maxContactsPerDay ?? before?.maxContactsPerDay), defaultLanguage: f.defaultLanguage ?? before?.defaultLanguage,
  }).where(eq(T.organizations.id, ctx.orgId)).returning();
  await audit(db, ctx, { action: 'settings', entity: 'organization', entityId: ctx.orgId, before, after, summary: 'Organisation settings updated' });
}

export async function upsertBranch(ctx: Ctx, f: Record<string, string>) {
  assertCan(ctx, 'settings.write');
  if (!f.name || !f.code) throw new UserError('Branch code and name are required');
  if (f.id) await db.update(T.branches).set({ name: f.name, code: f.code, city: opt(f.city), address: opt(f.address) }).where(and(eq(T.branches.id, f.id), eq(T.branches.orgId, ctx.orgId)));
  else await db.insert(T.branches).values({ orgId: ctx.orgId, name: f.name, code: f.code, city: opt(f.city), state: opt(f.state), address: opt(f.address) });
  await audit(db, ctx, { action: 'branch.save', entity: 'branch', summary: `Branch ${f.code} ${f.name} saved` });
}

export async function upsertUser(ctx: Ctx, f: Record<string, string>) {
  assertCan(ctx, 'users.write');
  if (!f.name || !f.email || !f.role) throw new UserError('Name, email and role are required');
  if (f.role === 'OWNER' && ctx.role !== 'OWNER') throw new UserError('Only the owner can add another owner');
  const values = { name: f.name, email: f.email.toLowerCase(), role: f.role as never, branchId: opt(f.branchId), phone: opt(f.phone), active: f.active !== 'off' };
  if (f.id) {
    await db.update(T.users).set({ ...values, ...(f.password ? { passwordHash: await bcrypt.hash(f.password, 10) } : {}) }).where(and(eq(T.users.id, f.id), eq(T.users.orgId, ctx.orgId)));
  } else {
    if (!f.password || f.password.length < 8) throw new UserError('Set a password of at least 8 characters');
    await db.insert(T.users).values({ ...values, orgId: ctx.orgId, passwordHash: await bcrypt.hash(f.password, 10) });
  }
  await audit(db, ctx, { action: 'user.save', entity: 'user', summary: `User ${f.email} saved as ${f.role}` });
}

export async function upsertProduct(ctx: Ctx, f: Record<string, string>) {
  assertCan(ctx, 'settings.write');
  if (!f.name || !f.assetType || !f.interestMethod || !f.annualRate) throw new UserError('Name, asset type, interest method and rate are required');
  const values = {
    name: f.name, assetType: f.assetType as never, interestMethod: f.interestMethod as never, frequency: (f.frequency || 'MONTHLY') as never,
    annualRate: f.annualRate, penalRate: f.penalRate || '2', minAmount: f.minAmount || '1000', maxAmount: f.maxAmount || '10000000',
    minTenure: Number(f.minTenure || 1), maxTenure: Number(f.maxTenure || 36), maxLtv: opt(f.maxLtv), processingFeePct: f.processingFeePct || '1',
    gstRate: f.gstRate || '18', graceDays: Number(f.graceDays || 3), active: f.active !== 'off',
  };
  if (f.id) await db.update(T.products).set(values).where(and(eq(T.products.id, f.id), eq(T.products.orgId, ctx.orgId)));
  else await db.insert(T.products).values({ ...values, orgId: ctx.orgId });
  await audit(db, ctx, { action: 'product.save', entity: 'product', summary: `Product ${f.name} saved` });
}

export async function setTarget(ctx: Ctx, f: Record<string, string>) {
  assertCan(ctx, 'settings.write');
  await db.insert(T.branchTargets).values({ branchId: f.branchId, month: f.month, disbursalTarget: f.disbursalTarget, collectionTarget: f.collectionTarget, incentivePct: f.incentivePct || '0' })
    .onConflictDoUpdate({ target: [T.branchTargets.branchId, T.branchTargets.month], set: { disbursalTarget: f.disbursalTarget, collectionTarget: f.collectionTarget, incentivePct: f.incentivePct || '0' } });
}

export const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');

export async function createApiKey(ctx: Ctx, name: string) {
  assertCan(ctx, 'settings.write');
  const key = `fx_live_${randomBytes(24).toString('base64url')}`;
  await db.insert(T.apiKeys).values({ orgId: ctx.orgId, name, prefix: key.slice(0, 12), hash: hashKey(key) });
  await audit(db, ctx, { action: 'apikey.create', entity: 'api_key', summary: `API key "${name}" created` });
  return key;
}
