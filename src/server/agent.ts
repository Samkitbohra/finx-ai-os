// Conversational AI for collections: one approved script per language, one set of contact rules, one log.
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Ctx } from '@/lib/auth';
import { assertCan } from '@/lib/auth';
import type { Channel } from '@/db/schema';
import { UserError } from '@/lib/permissions';
import { fmtP, fromPaise, toPaise } from '@/lib/money';
import { addDays, fmtDate, hourIST, todayIST } from '@/lib/dates';
import { computeDues } from '@/lib/interest';
import { complete, llmEnabled } from '@/lib/llm';
import { send } from './channels';
import { audit, fmtNo } from './core';

const T = schema;

export const LANGUAGES: Record<string, string> = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi',
  bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', or: 'Odia', as: 'Assamese', ur: 'Urdu',
};

export const TEMPLATE_KEYS = ['DUE_REMINDER', 'OVERDUE', 'RECEIPT', 'STATEMENT', 'AUCTION_NOTICE'] as const;

/** Base scripts. English is the source; Hindi and Tamil are hand-written; other languages are translated once and approved. */
const BASE: Record<string, Record<string, string>> = {
  en: {
    DUE_REMINDER: 'Hello {{name}}, {{amount}} is due on your {{product}} {{loanNo}} with {{lender}} on {{dueDate}}. Rate applied: {{rate}}. Pay here: {{payLink}}',
    OVERDUE: 'Hello {{name}}, {{amount}} on your loan {{loanNo}} with {{lender}} is {{dpd}} days overdue. Please pay today to avoid further penal interest: {{payLink}}. Reply if you need more time.',
    RECEIPT: 'Received {{amount}} on loan {{loanNo}} on {{date}}. Outstanding is now {{outstanding}}. Receipt {{receiptNo}}. Thank you — {{lender}}',
    STATEMENT: 'Dear {{name}},\n\nYour {{product}} {{loanNo}} has an outstanding of {{outstanding}} at {{rate}}. {{nextLine}}\n\nReply to this email and we will help — no portal, no login.\n\n{{lender}}',
    AUCTION_NOTICE: 'Dear {{name}}, your gold loan {{loanNo}} with {{lender}} is {{dpd}} days overdue. If {{amount}} is not paid by {{dueDate}}, the pledged gold may be auctioned as per the loan agreement. Please contact the branch.',
  },
  hi: {
    DUE_REMINDER: 'नमस्ते {{name}}, {{lender}} के साथ आपके लोन {{loanNo}} की {{amount}} की किस्त {{dueDate}} को देय है। ब्याज दर: {{rate}}। यहाँ भुगतान करें: {{payLink}}',
    OVERDUE: 'नमस्ते {{name}}, {{lender}} के साथ आपके लोन {{loanNo}} पर {{amount}} की राशि {{dpd}} दिन से बकाया है। अतिरिक्त दंड ब्याज से बचने के लिए कृपया आज भुगतान करें: {{payLink}}। अधिक समय चाहिए तो जवाब दें।',
    RECEIPT: '{{date}} को लोन {{loanNo}} पर {{amount}} प्राप्त हुए। अब बकाया राशि {{outstanding}} है। रसीद {{receiptNo}}। धन्यवाद — {{lender}}',
  },
  ta: {
    DUE_REMINDER: 'வணக்கம் {{name}}, {{lender}} நிறுவனத்தில் உங்கள் கடன் {{loanNo}}-க்கு {{dueDate}} அன்று {{amount}} செலுத்த வேண்டும். வட்டி விகிதம்: {{rate}}. இங்கே செலுத்துங்கள்: {{payLink}}',
    OVERDUE: 'வணக்கம் {{name}}, {{lender}} நிறுவனத்தில் உங்கள் கடன் {{loanNo}}-ல் {{amount}} தொகை {{dpd}} நாட்களாக நிலுவையில் உள்ளது. கூடுதல் அபராத வட்டியைத் தவிர்க்க இன்றே செலுத்துங்கள்: {{payLink}}. அவகாசம் தேவைப்பட்டால் பதில் அனுப்புங்கள்.',
    RECEIPT: '{{date}} அன்று கடன் {{loanNo}}-க்கு {{amount}} பெறப்பட்டது. தற்போதைய நிலுவை {{outstanding}}. ரசீது {{receiptNo}}. நன்றி — {{lender}}',
  },
};

export async function seedTemplates(orgId: string) {
  const rows: (typeof T.messageTemplates.$inferInsert)[] = [];
  for (const [language, set] of Object.entries(BASE))
    for (const [key, body] of Object.entries(set)) rows.push({ orgId, key, language, body, approved: true, approvedAt: new Date() });
  await db.insert(T.messageTemplates).values(rows).onConflictDoNothing();
}

/** Translate the English script into a language once, for a manager to review and approve. */
export async function translateTemplate(ctx: Ctx, key: string, language: string) {
  assertCan(ctx, 'settings.write');
  if (!LANGUAGES[language]) throw new UserError('Unsupported language');
  const en = await db.query.messageTemplates.findFirst({ where: and(eq(T.messageTemplates.orgId, ctx.orgId), eq(T.messageTemplates.key, key), eq(T.messageTemplates.language, 'en')) });
  if (!en) throw new UserError('English template missing');
  if (!llmEnabled()) throw new UserError('Set ANTHROPIC_API_KEY to translate scripts, or type the translation yourself.');
  const body = await complete(
    'You translate short loan-servicing messages for Indian borrowers. Keep every {{placeholder}} exactly as written. Use simple, polite, everyday words a person with basic literacy understands. Do not add or remove information. Output only the translation.',
    `Translate into ${LANGUAGES[language]}:\n\n${en.body}`,
  );
  const [row] = await db.insert(T.messageTemplates).values({ orgId: ctx.orgId, key, language, body, approved: false })
    .onConflictDoUpdate({ target: [T.messageTemplates.orgId, T.messageTemplates.key, T.messageTemplates.language], set: { body, approved: false, approvedAt: null } }).returning();
  await audit(db, ctx, { action: 'template.translate', entity: 'template', entityId: row.id, summary: `${key} translated to ${LANGUAGES[language]} — awaiting approval` });
  return row;
}

export async function saveTemplate(ctx: Ctx, key: string, language: string, body: string, approve: boolean) {
  assertCan(ctx, 'settings.write');
  const [row] = await db.insert(T.messageTemplates).values({ orgId: ctx.orgId, key, language, body, approved: approve, approvedAt: approve ? new Date() : null })
    .onConflictDoUpdate({ target: [T.messageTemplates.orgId, T.messageTemplates.key, T.messageTemplates.language], set: { body, approved: approve, approvedAt: approve ? new Date() : null } }).returning();
  await audit(db, ctx, { action: approve ? 'template.approve' : 'template.save', entity: 'template', entityId: row.id, summary: `${key} (${LANGUAGES[language]}) ${approve ? 'approved' : 'saved as draft'}` });
  return row;
}

const render = (body: string, vars: Record<string, string>) => body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

async function templateFor(orgId: string, key: string, language: string) {
  const rows = await db.select().from(T.messageTemplates).where(and(eq(T.messageTemplates.orgId, orgId), eq(T.messageTemplates.key, key), eq(T.messageTemplates.approved, true), inArray(T.messageTemplates.language, [language, 'en'])));
  return rows.find((r) => r.language === language) ?? rows.find((r) => r.language === 'en') ?? null;
}

/** Contact rules, enforced before anything is sent. Returns a reason when contact is not allowed. */
export async function contactBlock(org: typeof T.organizations.$inferSelect, b: typeof T.borrowers.$inferSelect, channel: Channel, now = new Date()): Promise<string | null> {
  if (b.doNotContact) return 'Borrower asked not to be contacted';
  if (channel !== 'EMAIL' && !b.consentChannels.includes(channel)) return `No consent on file for ${channel.toLowerCase()}`;
  if (channel === 'EMAIL' && !b.email) return 'No email on file';
  if (channel === 'VOICE' || channel === 'SMS' || channel === 'WHATSAPP') {
    const h = hourIST(now);
    if (h < org.callWindowStart || h >= org.callWindowEnd) return `Outside permitted hours (${org.callWindowStart}:00–${org.callWindowEnd}:00 IST)`;
  }
  const since = new Date(`${todayIST(now)}T00:00:00+05:30`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(T.communications)
    .where(and(eq(T.communications.borrowerId, b.id), eq(T.communications.direction, 'OUT'), gte(T.communications.createdAt, since), inArray(T.communications.status, ['SENT', 'DELIVERED', 'READ', 'COMPLETED'])));
  if (n >= org.maxContactsPerDay) return `Daily contact limit reached (${org.maxContactsPerDay})`;
  return null;
}

export async function contactBorrower(ctx: Ctx, loanId: string, channel: Channel, key: string, opts: { now?: Date; extra?: Record<string, string> } = {}) {
  assertCan(ctx, 'comms.send');
  const loan = await db.query.loans.findFirst({ where: and(eq(T.loans.id, loanId), eq(T.loans.orgId, ctx.orgId)) });
  if (!loan) throw new UserError('Loan not found');
  const [org, b, product] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(T.organizations.id, ctx.orgId) }),
    db.query.borrowers.findFirst({ where: eq(T.borrowers.id, loan.borrowerId) }),
    db.query.products.findFirst({ where: eq(T.products.id, loan.productId) }),
  ]);
  if (!org || !b || !product) throw new Error('Missing loan context');
  const tpl = await templateFor(ctx.orgId, key, b.language);
  if (!tpl) throw new UserError(`No approved ${key} script`);
  const inst = await db.select().from(T.installments).where(eq(T.installments.loanId, loanId)).orderBy(asc(T.installments.seq));
  const dues = loan.startDate ? computeDues({
    method: loan.interestMethod, frequency: loan.frequency, annualRate: Number(loan.annualRate), penalRate: Number(loan.penalRate), graceDays: product.graceDays,
    outstanding: toPaise(loan.outstandingPrincipal), interestPaidTo: loan.interestPaidTo, startDate: loan.startDate,
  }, inst.map((r) => ({ seq: r.seq, dueDate: r.dueDate, principalDue: toPaise(r.principalDue), interestDue: toPaise(r.interestDue), principalPaid: toPaise(r.principalPaid), interestPaid: toPaise(r.interestPaid) })), todayIST()) : null;
  const amount = dues ? (dues.dueNow > 0 ? dues.dueNow : dues.nextDue?.amount ?? 0) : 0;
  const vars: Record<string, string> = {
    name: b.name.split(' ')[0], lender: org.name, loanNo: fmtNo.loan(loan.loanNo), product: product.name.toLowerCase(),
    amount: fmtP(amount), dueDate: fmtDate(dues?.dueNow ? todayIST() : dues?.nextDue?.date ?? todayIST()), dpd: String(loan.dpd),
    rate: `${Number(loan.annualRate)}% ${loan.interestMethod === 'FLAT' ? 'flat' : 'reducing'}`, outstanding: fmtP(toPaise(loan.outstandingPrincipal)),
    payLink: `${process.env.APP_URL ?? ''}/app/pay/${loan.id}`, date: fmtDate(todayIST()),
    nextLine: dues?.nextDue ? `Your next payment of ${fmtP(dues.nextDue.amount)} is due on ${fmtDate(dues.nextDue.date)}.` : '', ...opts.extra,
  };
  const text = render(tpl.body, vars);
  const block = await contactBlock(org, b, channel, opts.now);
  const [comm] = await db.insert(T.communications).values({
    orgId: ctx.orgId, borrowerId: b.id, loanId, channel, templateKey: key, language: tpl.language, content: text,
    status: block ? 'BLOCKED' : 'SCHEDULED', blockReason: block,
  }).returning();
  if (block) return { comm, blocked: block };
  const r = await send(channel, { phone: b.phone, email: b.email, name: b.name }, { text, language: tpl.language, subject: `${product.name} ${vars.loanNo} — ${org.name}`, callbackRef: comm.id });
  const [after] = await db.update(T.communications).set({
    status: r.ok ? (channel === 'VOICE' ? 'SENT' : 'DELIVERED') : 'FAILED', provider: r.provider, providerRef: r.providerRef ?? null,
    sentAt: new Date(), blockReason: r.error ?? null,
  }).where(eq(T.communications.id, comm.id)).returning();
  // WhatsApp failed or no WhatsApp: fall back to SMS
  if (!r.ok && channel === 'WHATSAPP') return contactBorrower(ctx, loanId, 'SMS', key, opts);
  await audit(db, ctx, { action: 'contact', entity: 'loan', entityId: loanId, summary: `${channel} ${key} to ${b.name} (${tpl.language})${r.simulated ? ' — simulated' : ''}` });
  return { comm: after, simulated: r.simulated };
}

/** Record the outcome of a call (from the voice provider's webhook, or logged by staff). */
export async function logOutcome(ctx: Ctx, commId: string, o: { outcome: (typeof T.commOutcomeEnum.enumValues)[number]; transcript?: string; ptpDate?: string; ptpAmount?: number; durationSec?: number }) {
  const [c] = await db.update(T.communications).set({
    status: 'COMPLETED', outcome: o.outcome, transcript: o.transcript ?? null, ptpDate: o.ptpDate ?? null,
    ptpAmount: o.ptpAmount != null ? fromPaise(Math.round(o.ptpAmount * 100)) : null, durationSec: o.durationSec ?? null,
  }).where(and(eq(T.communications.id, commId), eq(T.communications.orgId, ctx.orgId))).returning();
  if (!c) throw new UserError('Communication not found');
  await audit(db, ctx, { action: 'contact.outcome', entity: 'loan', entityId: c.loanId, summary: `Outcome: ${o.outcome.replace(/_/g, ' ').toLowerCase()}${o.ptpDate ? ` · promise to pay ${o.ptpAmount ? fmtP(o.ptpAmount * 100) : ''} by ${fmtDate(o.ptpDate)}` : ''}` });
  return c;
}

/**
 * The daily collections run. Picks every active loan with something due soon or overdue, chooses the channel
 * by stage, and contacts the borrower inside the rules:
 *   due in ≤ 3 days → WhatsApp reminder (SMS fallback) · 1–15 days late → WhatsApp + call · 15+ days → call
 *   gold loans 60+ days late → auction notice
 */
export async function runCollections(ctx: Ctx, opts: { dryRun?: boolean; now?: Date } = {}) {
  assertCan(ctx, 'comms.send');
  const today = todayIST(opts.now);
  const active = await db.select({ id: T.loans.id, dpd: T.loans.dpd, assetType: T.products.assetType, borrowerId: T.loans.borrowerId })
    .from(T.loans).innerJoin(T.products, eq(T.products.id, T.loans.productId))
    .where(and(eq(T.loans.orgId, ctx.orgId), eq(T.loans.status, 'ACTIVE'), ctx.branchId ? eq(T.loans.branchId, ctx.branchId) : undefined));
  const soon = await db.select({ loanId: T.installments.loanId }).from(T.installments)
    .where(and(inArray(T.installments.loanId, active.map((a) => a.id).concat('-')), sql`${T.installments.status} <> 'PAID'`, gte(T.installments.dueDate, today), sql`${T.installments.dueDate} <= ${addDays(today, 3)}`));
  const soonSet = new Set(soon.map((s) => s.loanId));
  const plan: { loanId: string; channel: Channel; key: string }[] = [];
  for (const l of active) {
    if (l.dpd === 0 && soonSet.has(l.id)) plan.push({ loanId: l.id, channel: 'WHATSAPP', key: 'DUE_REMINDER' });
    else if (l.dpd > 0 && l.dpd <= 15) { plan.push({ loanId: l.id, channel: 'WHATSAPP', key: 'OVERDUE' }); plan.push({ loanId: l.id, channel: 'VOICE', key: 'OVERDUE' }); }
    else if (l.dpd > 15) {
      plan.push({ loanId: l.id, channel: 'VOICE', key: 'OVERDUE' });
      if (l.assetType === 'GOLD' && l.dpd >= 60) plan.push({ loanId: l.id, channel: 'SMS', key: 'AUCTION_NOTICE' });
    }
  }
  if (opts.dryRun) return { planned: plan.length, sent: 0, blocked: 0, plan };
  let sent = 0, blocked = 0;
  for (const p of plan) {
    const r = await contactBorrower({ ...ctx, via: 'AGENT' }, p.loanId, p.channel, p.key, { now: opts.now, extra: p.key === 'AUCTION_NOTICE' ? { dueDate: fmtDate(addDays(today, 14)) } : undefined }).catch(() => ({ blocked: 'error' }));
    if ('blocked' in r && r.blocked) blocked++; else sent++;
  }
  return { planned: plan.length, sent, blocked, plan };
}

/** An inbound reply on WhatsApp/SMS/email: file it on the right loan, understand it, and answer or escalate. */
export async function handleInbound(orgId: string, msg: { channel: Channel; from: string; text: string }) {
  const phone = msg.from.replace(/\D/g, '').slice(-10);
  const b = await db.query.borrowers.findFirst({ where: and(eq(T.borrowers.orgId, orgId), sql`right(regexp_replace(${T.borrowers.phone}, '\\D', '', 'g'), 10) = ${phone}`) });
  if (!b) return { matched: false };
  const loan = await db.query.loans.findFirst({ where: and(eq(T.loans.borrowerId, b.id), eq(T.loans.status, 'ACTIVE')), orderBy: (l, { desc }) => desc(l.dpd) });
  let intent: 'PAID' | 'MORE_TIME' | 'DISPUTE' | 'QUESTION' | 'OTHER' = 'OTHER';
  let ptpDate: string | null = null;
  if (llmEnabled()) {
    try {
      const out = await complete('Classify a borrower reply to a loan reminder. Reply with JSON only: {"intent":"PAID|MORE_TIME|DISPUTE|QUESTION|OTHER","ptpDate":"YYYY-MM-DD or null"}. Today is ' + todayIST(), msg.text, 100);
      const j = JSON.parse(out.replace(/```json|```/g, ''));
      intent = j.intent; ptpDate = j.ptpDate || null;
    } catch { /* fall through to keywords */ }
  }
  if (intent === 'OTHER') {
    const t = msg.text.toLowerCase();
    if (/paid|done|sent|transfer|கட்டி|செலுத்த|भर दिया|जमा/.test(t)) intent = 'PAID';
    else if (/week|time|later|next|tomorrow|wait|अगले|கொஞ்சம்/.test(t)) { intent = 'MORE_TIME'; ptpDate = addDays(todayIST(), 7); }
    else if (/wrong|not mine|dispute|galat|தவறு/.test(t)) intent = 'DISPUTE';
  }
  const outcome = intent === 'PAID' ? 'PAID' : intent === 'MORE_TIME' ? 'PROMISE_TO_PAY' : intent === 'DISPUTE' ? 'ESCALATED' : 'INFO_ONLY';
  const [c] = await db.insert(T.communications).values({ orgId, borrowerId: b.id, loanId: loan?.id ?? null, channel: msg.channel, direction: 'IN', content: msg.text, language: b.language, status: 'COMPLETED', outcome, ptpDate, provider: 'inbound' }).returning();
  return { matched: true, borrowerId: b.id, loanId: loan?.id, intent, communicationId: c.id };
}
