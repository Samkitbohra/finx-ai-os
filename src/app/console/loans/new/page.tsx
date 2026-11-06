import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { NewLoanForm } from './form';
import { createLoanAction } from '../../actions';

export const metadata = { title: 'New loan' };

export default async function NewLoan({ searchParams }: { searchParams: Promise<{ borrower?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx('loan.create');
  const [products, borrowers] = await Promise.all([
    db.select().from(schema.products).where(and(eq(schema.products.orgId, ctx.orgId), eq(schema.products.active, true))).orderBy(asc(schema.products.assetType), asc(schema.products.name)),
    db.select({ id: schema.borrowers.id, code: schema.borrowers.code, name: schema.borrowers.name, phone: schema.borrowers.phone, kyc: schema.borrowers.kycStatus })
      .from(schema.borrowers).where(and(eq(schema.borrowers.orgId, ctx.orgId), ctx.branchId ? eq(schema.borrowers.branchId, ctx.branchId) : undefined)).orderBy(asc(schema.borrowers.name)),
  ]);
  return (
    <>
      <PageHeader back={{ href: '/console/loans', label: 'Loans' }} title="New loan" sub="Capture the asset, check LTV and see the schedule before you submit for approval." />
      <NewLoanForm action={createLoanAction} borrowers={borrowers} defaultBorrower={sp.borrower}
        products={products.map((p) => ({ id: p.id, name: p.name, assetType: p.assetType, method: p.interestMethod, frequency: p.frequency, rate: Number(p.annualRate), min: Number(p.minAmount), max: Number(p.maxAmount), minTenure: p.minTenure, maxTenure: p.maxTenure, maxLtv: p.maxLtv ? Number(p.maxLtv) : null, tiers: p.ltvTiers, fee: Number(p.processingFeePct), gst: Number(p.gstRate) }))} />
    </>
  );
}
