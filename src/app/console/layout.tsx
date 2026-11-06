import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/permissions';
import { Shell } from '@/components/shell';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const T = schema;
  const [org, branch, counts] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(T.organizations.id, ctx.orgId) }),
    ctx.branchId ? db.query.branches.findFirst({ where: eq(T.branches.id, ctx.branchId) }) : null,
    db.select({
      loans: sql<number>`count(*) filter (where ${T.loans.status} = 'ACTIVE')::int`,
      approvals: sql<number>`count(*) filter (where ${T.loans.status} in ('PENDING_APPROVAL','APPROVED'))::int`,
      overdue: sql<number>`count(*) filter (where ${T.loans.status} = 'ACTIVE' and ${T.loans.dpd} > 0)::int`,
    }).from(T.loans).where(and(eq(T.loans.orgId, ctx.orgId), ctx.branchId ? eq(T.loans.branchId, ctx.branchId) : undefined)),
  ]);
  void gt;
  return (
    <Shell user={{ name: ctx.name, role: ROLE_LABEL[ctx.role], branch: branch?.name ?? null }} org={org?.name ?? ''} counts={counts[0]}>
      {children}
    </Shell>
  );
}
