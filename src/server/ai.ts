// FinX AI: staff type what they want; the model calls tools over live data.
// Read tools run immediately. Write tools never run until the user confirms the exact change in the UI.
import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Ctx } from '@/lib/auth';
import { can, Action } from '@/lib/permissions';
import { anthropic, llmEnabled, MODEL } from '@/lib/llm';
import { fmtP, toPaise, fmtCompact } from '@/lib/money';
import { fmtDate, todayIST, addMonths } from '@/lib/dates';
import * as L from './loans';
import * as A from './agent';
import { portfolio, listLoans, trialBalance, profitAndLoss, loanDetail } from './reports';
import { fmtNo } from './core';

const T = schema;
type Block = Anthropic.ContentBlockParam;
type Msg = Anthropic.MessageParam;

interface ToolDef { name: string; description: string; input_schema: Anthropic.Tool['input_schema']; write?: Action; summarize?: (i: Record<string, unknown>, ctx: Ctx) => Promise<string> }

const loanByNo = async (ctx: Ctx, n: unknown) => L.findLoanByNo(ctx, Number(String(n).replace(/\D/g, '')));
const borrowerByCode = async (ctx: Ctx, c: unknown) => {
  const code = Number(String(c).replace(/\D/g, ''));
  const b = await db.query.borrowers.findFirst({ where: and(eq(T.borrowers.orgId, ctx.orgId), eq(T.borrowers.code, code)) });
  if (!b) throw new Error(`Borrower B-${code} not found`);
  return b;
};

export const TOOLS: ToolDef[] = [
  { name: 'search', description: 'Find borrowers and loans by name, phone, PAN or loan number.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'portfolio_summary', description: 'Book value, yield, NPA, collections this month, ageing buckets and pending approvals.', input_schema: { type: 'object', properties: {} } },
  { name: 'list_loans', description: 'List loans with filters. Use min_days_late for overdue questions.', input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['ACTIVE', 'PENDING_APPROVAL', 'APPROVED', 'CLOSED'] }, min_days_late: { type: 'number' }, asset_type: { type: 'string', enum: ['GOLD', 'VEHICLE', 'PROPERTY', 'MACHINERY', 'BUSINESS', 'UNSECURED'] }, limit: { type: 'number' } } } },
  { name: 'get_loan', description: 'Full details of one loan: terms, dues today, payoff, schedule status, collateral, last payments and contacts.', input_schema: { type: 'object', properties: { loan_no: { type: 'number' } }, required: ['loan_no'] } },
  { name: 'list_products', description: 'Loan products with rates, limits and LTV caps (needed before creating a loan).', input_schema: { type: 'object', properties: {} } },
  { name: 'trial_balance', description: 'Trial balance as of a date (YYYY-MM-DD, default today).', input_schema: { type: 'object', properties: { as_of: { type: 'string' } } } },
  { name: 'profit_and_loss', description: 'Income, expenses and net profit for a period.', input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } },
  { name: 'list_invoices', description: 'Recent invoices with GST, optionally for one loan.', input_schema: { type: 'object', properties: { loan_no: { type: 'number' }, invoice_no: { type: 'number' } } } },
  {
    name: 'create_borrower', write: 'borrower.write', description: 'Create a new borrower. Needs name and phone; language is a code like ta, hi, en.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, language: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' }, pan: { type: 'string' }, occupation: { type: 'string' }, consent_channels: { type: 'array', items: { type: 'string', enum: ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] } } }, required: ['name', 'phone'] },
    summarize: async (i) => `Create borrower **${i.name}** · ${i.phone}${i.language ? ` · ${String(i.language).toUpperCase()}` : ''}`,
  },
  {
    name: 'create_loan', write: 'loan.create', description: 'Create a loan and submit it for approval. For gold give net_weight_g and purity_karat; value is computed at the 22K rate unless collateral_value is given. Interest rate defaults to the product rate.',
    input_schema: { type: 'object', properties: { borrower_code: { type: 'number', description: 'B-number of the borrower' }, product_id: { type: 'string' }, amount: { type: 'number' }, tenure: { type: 'number' }, annual_rate: { type: 'number' }, collateral_description: { type: 'string' }, collateral_value: { type: 'number' }, net_weight_g: { type: 'number' }, purity_karat: { type: 'number' }, gold_rate_22k: { type: 'number' }, purpose: { type: 'string' } }, required: ['borrower_code', 'product_id', 'amount', 'tenure'] },
    summarize: async (i, ctx) => {
      const b = await borrowerByCode(ctx, i.borrower_code);
      const p = await db.query.products.findFirst({ where: eq(T.products.id, String(i.product_id)) });
      const val = i.collateral_value ?? (i.net_weight_g ? Math.round((Number(i.net_weight_g) * Number(i.gold_rate_22k ?? 6950) * Number(i.purity_karat ?? 22)) / 22) : null);
      return `New **${p?.name}** for **${b.name}**: ${fmtP(toPaise(Number(i.amount)))} for ${i.tenure} at ${i.annual_rate ?? Number(p?.annualRate)}%${val ? ` · collateral ${fmtP(toPaise(Number(val)))} (LTV ${((Number(i.amount) / Number(val)) * 100).toFixed(0)}%)` : ''} · goes to approval`;
    },
  },
  {
    name: 'record_payment', write: 'payment.record', description: 'Record a payment received on a loan.',
    input_schema: { type: 'object', properties: { loan_no: { type: 'number' }, amount: { type: 'number' }, mode: { type: 'string', enum: ['CASH', 'UPI', 'NEFT', 'CHEQUE'] }, reference: { type: 'string' }, date: { type: 'string' } }, required: ['loan_no', 'amount', 'mode'] },
    summarize: async (i, ctx) => { const l = await loanByNo(ctx, i.loan_no); const b = await db.query.borrowers.findFirst({ where: eq(T.borrowers.id, l.borrowerId) }); return `Record **${fmtP(toPaise(Number(i.amount)))}** ${i.mode} on loan ${fmtNo.loan(l.loanNo)} (${b?.name})${i.date ? ` dated ${fmtDate(String(i.date))}` : ''}`; },
  },
  {
    name: 'update_borrower', write: 'borrower.write', description: 'Correct a borrower’s details (phone, address, language, PAN, email, occupation, name).',
    input_schema: { type: 'object', properties: { borrower_code: { type: 'number' }, fields: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['borrower_code', 'fields'] },
    summarize: async (i, ctx) => { const b = await borrowerByCode(ctx, i.borrower_code); const f = i.fields as Record<string, string>; return `Update **${b.name}**: ${Object.entries(f).map(([k, v]) => `${k} ${String((b as Record<string, unknown>)[k] ?? '—')} → ${v}`).join(', ')}`; },
  },
  {
    name: 'reissue_invoice', write: 'invoice.write', description: 'Re-issue an invoice at a corrected GST rate. The amount collected stays the same and is re-split; the books are adjusted.',
    input_schema: { type: 'object', properties: { invoice_no: { type: 'number' }, gst_rate: { type: 'number' } }, required: ['invoice_no', 'gst_rate'] },
    summarize: async (i) => `Re-issue invoice **INV-${String(i.invoice_no).padStart(5, '0')}** at **${i.gst_rate}% GST** and post the adjusting entry`,
  },
  {
    name: 'contact_borrower', write: 'comms.send', description: 'Send a reminder or follow-up to the borrower of a loan, inside the contact rules.',
    input_schema: { type: 'object', properties: { loan_no: { type: 'number' }, channel: { type: 'string', enum: ['WHATSAPP', 'VOICE', 'SMS', 'EMAIL'] }, template: { type: 'string', enum: ['DUE_REMINDER', 'OVERDUE', 'STATEMENT'] } }, required: ['loan_no', 'channel', 'template'] },
    summarize: async (i, ctx) => { const l = await loanByNo(ctx, i.loan_no); const b = await db.query.borrowers.findFirst({ where: eq(T.borrowers.id, l.borrowerId) }); return `Send **${String(i.template).replace(/_/g, ' ').toLowerCase()}** to ${b?.name} by **${String(i.channel).toLowerCase()}**`; },
  },
];

export async function runTool(ctx: Ctx, name: string, i: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search': {
      const q = String(i.query ?? '');
      const n = Number(q.replace(/\D/g, ''));
      const bs = await db.select({ code: T.borrowers.code, name: T.borrowers.name, phone: T.borrowers.phone, kyc: T.borrowers.kycStatus, score: T.borrowers.repaymentScore }).from(T.borrowers)
        .where(and(eq(T.borrowers.orgId, ctx.orgId), or(ilike(T.borrowers.name, `%${q}%`), ilike(T.borrowers.phone, `%${q}%`), ilike(T.borrowers.pan, `%${q}%`), n ? eq(T.borrowers.code, n) : undefined))).limit(10);
      const ls = (await listLoans(ctx, { q, limit: 10 })).map((l) => ({ loan_no: l.loanNo, borrower: l.borrowerName, product: l.product, status: l.status, outstanding: Number(l.outstanding), days_late: l.dpd }));
      return { borrowers: bs.map((b) => ({ ...b, borrower_code: b.code })), loans: ls };
    }
    case 'portfolio_summary': {
      const p = await portfolio(ctx);
      return { book_value: fmtCompact(p.aum / 100), live_loans: p.loans, yield_pct: +p.yieldPct.toFixed(2), npa_90_pct: +p.npaPct.toFixed(2), collected_this_month: fmtP(p.collectedMtd), collected_last_month: fmtP(p.collectedLastMonth), disbursed_this_month: fmtP(p.disbursedMtd), ageing: Object.fromEntries(Object.entries(p.buckets).map(([k, v]) => [k, { loans: p.counts[k as keyof typeof p.counts], outstanding: fmtP(v) }])), pending_approvals: p.pendingApprovals, awaiting_disbursal: p.awaitingDisbursal };
    }
    case 'list_loans': {
      const rows = await listLoans(ctx, { status: (i.status as string) ?? 'ACTIVE', dpdMin: i.min_days_late != null ? Number(i.min_days_late) : undefined, assetType: i.asset_type as string | undefined, limit: Math.min(Number(i.limit ?? 25), 50) });
      return rows.map((l) => ({ loan_no: l.loanNo, borrower: l.borrowerName, phone: l.phone, product: l.product, outstanding: Number(l.outstanding), days_late: l.dpd, rate: Number(l.rate), branch: l.branch }));
    }
    case 'get_loan': {
      const l = await loanByNo(ctx, i.loan_no);
      const d = (await loanDetail(ctx, l.id))!;
      const dues = l.startDate ? await L.getDues(ctx, l.id) : null;
      return {
        loan_no: l.loanNo, status: l.status, borrower: { name: d.borrower.name, code: d.borrower.code, phone: d.borrower.phone, language: d.borrower.language, kyc: d.borrower.kycStatus, repayment_score: d.borrower.repaymentScore },
        product: d.product.name, principal: Number(l.principal), rate: `${Number(l.annualRate)}% ${l.interestMethod.toLowerCase()}`, tenure: l.tenure, frequency: l.frequency, disbursed: l.startDate, maturity: l.maturityDate,
        outstanding_principal: Number(l.outstandingPrincipal), ltv_at_sanction: l.ltvAtSanction, days_late: l.dpd,
        dues_today: dues && { penalty: dues.penalty / 100, interest: dues.interest / 100, principal_overdue: dues.principalOverdue / 100, due_now: dues.dueNow / 100, payoff_today: dues.payoff / 100, next_due: dues.nextDue && { date: dues.nextDue.date, amount: dues.nextDue.amount / 100 } },
        collateral: d.collaterals.map((c) => ({ description: c.description, value: Number(c.value), status: c.status, details: c.details })),
        installments: { total: d.installments.length, paid: d.installments.filter((x) => x.status === 'PAID').length, late: d.installments.filter((x) => x.status !== 'PAID' && x.dueDate < todayIST()).length },
        last_payments: d.payments.slice(0, 5).map((p) => ({ receipt: fmtNo.receipt(p.receiptNo), date: p.receivedAt.toISOString().slice(0, 10), amount: Number(p.amount), mode: p.mode, reversed: p.reversed })),
        last_contacts: d.communications.slice(0, 5).map((c) => ({ date: c.createdAt.toISOString().slice(0, 10), channel: c.channel, status: c.status, outcome: c.outcome, promise: c.ptpDate })),
      };
    }
    case 'list_products':
      return (await db.select().from(T.products).where(and(eq(T.products.orgId, ctx.orgId), eq(T.products.active, true))).orderBy(asc(T.products.assetType)))
        .map((p) => ({ product_id: p.id, name: p.name, asset: p.assetType, interest: `${Number(p.annualRate)}% ${p.interestMethod.toLowerCase()}`, repayment: p.frequency, amount: `${Number(p.minAmount)}–${Number(p.maxAmount)}`, tenure: `${p.minTenure}–${p.maxTenure}`, max_ltv: p.maxLtv ? Number(p.maxLtv) : null }));
    case 'trial_balance': {
      const tb = await trialBalance(ctx, (i.as_of as string) || todayIST());
      return { as_of: tb.asOf, ties_out: tb.totalDebit === tb.totalCredit, total_debit: tb.totalDebit / 100, total_credit: tb.totalCredit / 100, rows: tb.rows.map((r) => ({ account: `${r.code} ${r.name}`, debit: r.debit / 100, credit: r.credit / 100 })),
        unreconciled_note: `Unapplied receipts: ${fmtP(tb.rows.find((r) => r.code === '2300')?.credit ?? 0)}` };
    }
    case 'profit_and_loss': {
      const to = (i.to as string) || todayIST(); const from = (i.from as string) || `${addMonths(to, 0).slice(0, 7)}-01`;
      const p = await profitAndLoss(ctx, from, to);
      return { from, to, income: p.income.map((r) => ({ [r.name]: r.balance / 100 })), expenses: p.expense.map((r) => ({ [r.name]: r.balance / 100 })), total_income: p.totalIncome / 100, total_expense: p.totalExpense / 100, net_profit: p.net / 100 };
    }
    case 'list_invoices': {
      const conds = [eq(T.invoices.orgId, ctx.orgId)];
      if (i.loan_no) conds.push(eq(T.invoices.loanId, (await loanByNo(ctx, i.loan_no)).id));
      if (i.invoice_no) conds.push(eq(T.invoices.invoiceNo, Number(i.invoice_no)));
      return (await db.select().from(T.invoices).where(and(...conds)).orderBy(desc(T.invoices.invoiceNo)).limit(15)).map((x) => ({ invoice_no: x.invoiceNo, kind: x.kind, amount: Number(x.amount), gst_rate: Number(x.gstRate), gst: Number(x.gstAmount), total: Number(x.total), status: x.status }));
    }
    case 'create_borrower': {
      const b = await L.createBorrower(ctx, { name: String(i.name), phone: String(i.phone), language: (i.language as string) ?? 'en', address: i.address as string, city: i.city as string, pan: (i.pan as string) ?? '', occupation: i.occupation as string, consentChannels: (i.consent_channels as never) ?? ['VOICE', 'WHATSAPP', 'SMS'] });
      return { created: true, borrower_code: b.code, id: b.id, kyc: 'PENDING — verify documents before disbursal' };
    }
    case 'create_loan': {
      const b = await borrowerByCode(ctx, i.borrower_code);
      const p = await db.query.products.findFirst({ where: and(eq(T.products.id, String(i.product_id)), eq(T.products.orgId, ctx.orgId)) });
      if (!p) throw new Error('Unknown product_id — call list_products');
      const value = i.collateral_value != null ? Number(i.collateral_value) : i.net_weight_g ? Math.round((Number(i.net_weight_g) * Number(i.gold_rate_22k ?? 6950) * Number(i.purity_karat ?? 22)) / 22) : null;
      const loan = await L.createLoan(ctx, {
        borrowerId: b.id, productId: p.id, principal: Number(i.amount), tenure: Number(i.tenure), annualRate: i.annual_rate != null ? Number(i.annual_rate) : undefined, purpose: i.purpose as string,
        collaterals: p.maxLtv && value ? [{ assetType: p.assetType, description: String(i.collateral_description ?? p.assetType.toLowerCase()), value, details: p.assetType === 'GOLD' ? { netWeight: i.net_weight_g, purityKarat: i.purity_karat ?? 22 } : {} }] : [],
      });
      return { created: true, loan_no: loan.loanNo, status: loan.status, ltv: loan.ltvAtSanction, kyc: b.kycStatus, link: `/console/loans/${loan.id}` };
    }
    case 'record_payment': {
      const l = await loanByNo(ctx, i.loan_no);
      const r = await L.recordPayment(ctx, l.id, { amount: Number(i.amount), mode: String(i.mode) as never, reference: i.reference as string, date: i.date as string | undefined });
      return { receipt: fmtNo.receipt(r.payment.receiptNo), to_penalty: r.allocation.toPenalty / 100, to_interest: r.allocation.toInterest / 100, to_principal: r.allocation.toPrincipal / 100, outstanding_now: Number(r.loan.outstandingPrincipal), loan_closed: r.allocation.closed };
    }
    case 'update_borrower': {
      const b = await borrowerByCode(ctx, i.borrower_code);
      const allowed = ['name', 'phone', 'address', 'city', 'pincode', 'language', 'pan', 'email', 'occupation', 'altPhone'];
      const f = Object.fromEntries(Object.entries(i.fields as Record<string, string>).filter(([k]) => allowed.includes(k)));
      const after = await L.updateBorrower(ctx, b.id, f);
      return { updated: Object.keys(f), borrower_code: after.code };
    }
    case 'reissue_invoice': {
      const inv = await L.reissueInvoice(ctx, Number(i.invoice_no), Number(i.gst_rate));
      return { new_invoice: fmtNo.invoice(inv.invoiceNo), gst_rate: Number(inv.gstRate), taxable: Number(inv.amount), gst: Number(inv.gstAmount), total: Number(inv.total), books: 'Adjusting entry posted; trial balance still ties out' };
    }
    case 'contact_borrower': {
      const l = await loanByNo(ctx, i.loan_no);
      const r = await A.contactBorrower(ctx, l.id, String(i.channel) as never, String(i.template));
      return 'blocked' in r && r.blocked ? { sent: false, held_back: r.blocked } : { sent: true, simulated: 'simulated' in r ? r.simulated : false };
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

const system = (ctx: Ctx, orgName: string) => `You are FinX AI, the assistant inside FinX AI OS for ${orgName}, a licensed local lender in India.
Today is ${fmtDate(todayIST(), 'long')} (IST). You are helping ${ctx.name} (${ctx.role.toLowerCase().replace('_', ' ')}${ctx.branchId ? ', one branch' : ', all branches'}).
- Answer from live data using the tools. Never invent numbers, names or loan numbers.
- Money in Indian format with ₹ (₹1,18,600; ₹4.2 L; ₹1.2 Cr). Dates like 12 Oct 2026.
- Be brief: lead with the answer, then a short list or table if useful. Staff may write in Tamil, Hindi or English — reply in their language.
- To change anything (borrower, loan, payment, invoice, message), call the write tool directly with complete inputs. The user will see a confirmation card; do not ask "shall I proceed" first. If a required detail is missing, ask one short question.
- When a loan is created, say it is waiting for approval. Never claim something was saved until the tool result confirms it.
- Loans are referred to by number (e.g. loan 4471 → loan_no 4471). Borrowers by B-number.`;

// ---------------------------------------------------------------- conversation loop

export interface ChatTurn { messages: { role: string; content: unknown; pending?: unknown; id: string }[]; pending: { id: string; summary: string; tool: string } | null }

async function history(threadId: string): Promise<Msg[]> {
  const rows = await db.select().from(T.chatMessages).where(eq(T.chatMessages.threadId, threadId)).orderBy(asc(T.chatMessages.createdAt));
  return rows.map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content as Block[] }));
}
async function save(threadId: string, role: 'user' | 'assistant', content: Block[], pending?: unknown) {
  const [m] = await db.insert(T.chatMessages).values({ threadId, role, content, pending: pending ?? null }).returning();
  return m;
}

/** Run the model until it answers, or until it asks to change something (which waits for confirmation). */
async function loop(ctx: Ctx, threadId: string) {
  const org = await db.query.organizations.findFirst({ where: eq(T.organizations.id, ctx.orgId) });
  const tools = TOOLS.filter((t) => !t.write || can(ctx.role, t.write)).map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  for (let step = 0; step < 8; step++) {
    const msgs = await history(threadId);
    const r = await anthropic().messages.create({ model: MODEL(), max_tokens: 1500, system: system(ctx, org?.name ?? 'the lender'), tools, messages: msgs });
    const content = r.content as Block[];
    const uses = r.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!uses.length) { await save(threadId, 'assistant', content); return; }
    const writes = uses.filter((u) => TOOLS.find((t) => t.name === u.name)?.write);
    if (writes.length) {
      // run any reads in the same turn first, then hold the first write for confirmation
      const w = writes[0];
      const def = TOOLS.find((t) => t.name === w.name)!;
      let summary = `${w.name}`;
      try { summary = await def.summarize!(w.input as Record<string, unknown>, ctx); } catch (e) { summary = `${w.name}: ${(e as Error).message}`; }
      await save(threadId, 'assistant', content, { toolUseIds: uses.map((u) => u.id), write: { id: w.id, name: w.name, input: w.input }, summary });
      return;
    }
    const results: Block[] = [];
    for (const u of uses) results.push(await execute(ctx, u.id, u.name, u.input as Record<string, unknown>));
    await save(threadId, 'user', results);
  }
}

async function execute(ctx: Ctx, id: string, name: string, input: Record<string, unknown>): Promise<Block> {
  try {
    const out = await runTool({ ...ctx, via: 'CHAT' }, name, input);
    return { type: 'tool_result', tool_use_id: id, content: JSON.stringify(out) };
  } catch (e) {
    return { type: 'tool_result', tool_use_id: id, content: `Error: ${(e as Error).message}`, is_error: true };
  }
}

export async function chat(ctx: Ctx, input: { threadId?: string; message?: string; confirm?: boolean }) {
  let threadId = input.threadId;
  if (!threadId) {
    const [t] = await db.insert(T.chatThreads).values({ orgId: ctx.orgId, userId: ctx.userId!, title: (input.message ?? 'New chat').slice(0, 60) }).returning();
    threadId = t.id;
  } else {
    const t = await db.query.chatThreads.findFirst({ where: and(eq(T.chatThreads.id, threadId), eq(T.chatThreads.userId, ctx.userId!)) });
    if (!t) throw new Error('Chat not found');
  }
  const last = (await db.select().from(T.chatMessages).where(eq(T.chatMessages.threadId, threadId)).orderBy(desc(T.chatMessages.createdAt)).limit(1))[0];
  const pend = last?.pending as { toolUseIds: string[]; write: { id: string; name: string; input: Record<string, unknown> }; summary: string } | null;

  if (pend && input.confirm !== undefined) {
    // answer every tool_use in that assistant turn: the confirmed write runs; other writes are deferred; reads run
    const blocks = (last.content as Block[]).filter((b): b is Anthropic.ToolUseBlockParam => (b as { type: string }).type === 'tool_use');
    const results: Block[] = [];
    for (const u of blocks) {
      const def = TOOLS.find((t) => t.name === u.name)!;
      if (u.id === pend.write.id) results.push(input.confirm ? await execute(ctx, u.id, u.name, u.input as Record<string, unknown>) : { type: 'tool_result', tool_use_id: u.id, content: 'The user cancelled this change. Nothing was saved.' });
      else if (def.write) results.push({ type: 'tool_result', tool_use_id: u.id, content: 'Not run: only one change is confirmed at a time. Ask again if still needed.' });
      else results.push(await execute(ctx, u.id, u.name, u.input as Record<string, unknown>));
    }
    await db.update(T.chatMessages).set({ pending: null }).where(eq(T.chatMessages.id, last.id));
    await save(threadId, 'user', results);
  } else {
    if (pend) {
      // user typed instead of confirming: treat as cancel, then continue with their message
      const blocks = (last.content as Block[]).filter((b): b is Anthropic.ToolUseBlockParam => (b as { type: string }).type === 'tool_use');
      await db.update(T.chatMessages).set({ pending: null }).where(eq(T.chatMessages.id, last.id));
      await save(threadId, 'user', [...blocks.map((u) => ({ type: 'tool_result' as const, tool_use_id: u.id, content: 'Not run — the user replied instead of confirming.' })), { type: 'text', text: input.message ?? '' }]);
    } else await save(threadId, 'user', [{ type: 'text', text: input.message ?? '' }]);
  }

  if (llmEnabled()) await loop(ctx, threadId);
  else await offline(ctx, threadId, input.message ?? '');
  return { threadId };
}

/** Without an API key, FinX AI still answers the common questions from live data. */
async function offline(ctx: Ctx, threadId: string, q: string) {
  const t = q.toLowerCase();
  let text = 'FinX AI needs an Anthropic API key to understand free-form requests. Ask an admin to add ANTHROPIC_API_KEY. Meanwhile I can answer: “who is 30 days late?”, “portfolio summary”, “summarise loan 12”, “trial balance”.';
  const n = t.match(/loan\s*(\d+)/)?.[1];
  const days = /late|overdue|dpd/.test(t) ? t.match(/(\d+)\s*\+?\s*(?:days?|dpd)/)?.[1] : undefined;
  if (days || /late|overdue|due/.test(t)) {
    const rows = await runTool(ctx, 'list_loans', { min_days_late: Number(days ?? 1), limit: 15 }) as { loan_no: number; borrower: string; outstanding: number; days_late: number }[];
    text = rows.length ? `${rows.length === 15 ? 'Top 15 loans' : `${rows.length} loans`} ${days ?? 1}+ days late (most overdue first):\n\n${rows.map((r) => `- **${r.borrower}** · loan ${fmtNo.loan(r.loan_no)} · ${fmtP(toPaise(r.outstanding))} · ${r.days_late} days`).join('\n')}` : `No loans are ${days ?? 1}+ days late.`;
  } else if (n) {
    const d = await runTool(ctx, 'get_loan', { loan_no: Number(n) }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    text = `**Loan ${fmtNo.loan(d.loan_no)} · ${d.borrower.name}** (${d.product}, ${d.rate})\n\n- Outstanding principal: ${fmtP(toPaise(d.outstanding_principal))}\n- Due now: ${d.dues_today ? fmtP(toPaise(d.dues_today.due_now)) : '—'} · to close today: ${d.dues_today ? fmtP(toPaise(d.dues_today.payoff_today)) : '—'}\n- ${d.days_late ? `${d.days_late} days late` : 'Current'} · ${d.installments.paid}/${d.installments.total} instalments paid\n- Repayment score ${d.borrower.repayment_score}`;
  } else if (/portfolio|book|summary|npa|yield/.test(t)) {
    const p = await runTool(ctx, 'portfolio_summary', {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    text = `Book **${p.book_value}** across ${p.live_loans} loans · yield **${p.yield_pct}%** · NPA 90+ **${p.npa_90_pct}%** · collected this month **${p.collected_this_month}**. ${p.pending_approvals} loans wait for approval and ${p.awaiting_disbursal} for disbursal.`;
  } else if (/trial|balance|ledger|books/.test(t)) {
    const tb = await runTool(ctx, 'trial_balance', {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    text = `Trial balance as of ${fmtDate(tb.as_of)}: debits ${fmtP(toPaise(tb.total_debit))}, credits ${fmtP(toPaise(tb.total_credit))} — ${tb.ties_out ? 'it ties out' : 'it does NOT tie out'}. ${tb.unreconciled_note}.`;
  }
  await save(threadId, 'assistant', [{ type: 'text', text }]);
}

export async function threadView(ctx: Ctx, threadId: string) {
  const rows = await db.select().from(T.chatMessages).where(eq(T.chatMessages.threadId, threadId)).orderBy(asc(T.chatMessages.createdAt));
  const out: { id: string; role: 'user' | 'assistant'; text: string; tools: string[]; pending?: { summary: string; tool: string } }[] = [];
  for (const r of rows) {
    const blocks = r.content as { type: string; text?: string; name?: string }[];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const tools = blocks.filter((b) => b.type === 'tool_use').map((b) => b.name!);
    const pend = r.pending as { summary: string; write: { name: string } } | null;
    if (!text && !tools.length && !pend) continue; // tool results
    out.push({ id: r.id, role: r.role as 'user' | 'assistant', text, tools, pending: pend ? { summary: pend.summary, tool: pend.write.name } : undefined });
  }
  return out;
}

export async function threads(ctx: Ctx) {
  return db.select().from(T.chatThreads).where(and(eq(T.chatThreads.orgId, ctx.orgId), eq(T.chatThreads.userId, ctx.userId!))).orderBy(desc(T.chatThreads.createdAt)).limit(30);
}
export { sql };
