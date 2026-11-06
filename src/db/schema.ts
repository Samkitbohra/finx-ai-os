// FinX AI OS — data model (Drizzle ORM, PostgreSQL)
// One organisation (a lender) has branches, staff, borrowers and loans.
// Every money movement posts a balanced double-entry journal.
import {
  pgTable, pgEnum, text, integer, boolean, timestamp, numeric, jsonb, uniqueIndex, index, primaryKey, date,
} from 'drizzle-orm/pg-core';
import { createId } from './id';

const id = () => text('id').primaryKey().$defaultFn(createId);
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 6, scale: 3 });
const pct = (name: string) => numeric(name, { precision: 5, scale: 2 });
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- enums
export const roleEnum = pgEnum('role', ['OWNER', 'ADMIN', 'BRANCH_MANAGER', 'LOAN_OFFICER', 'ACCOUNTANT', 'COLLECTOR', 'AUDITOR']);
export const assetTypeEnum = pgEnum('asset_type', ['GOLD', 'VEHICLE', 'PROPERTY', 'MACHINERY', 'BUSINESS', 'UNSECURED']);
export const interestMethodEnum = pgEnum('interest_method', ['FLAT', 'REDUCING', 'DAILY']);
export const frequencyEnum = pgEnum('frequency', ['MONTHLY', 'WEEKLY', 'DAILY', 'BULLET']);
export const loanStatusEnum = pgEnum('loan_status', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'CLOSED', 'WRITTEN_OFF', 'AUCTIONED', 'REJECTED']);
export const installmentStatusEnum = pgEnum('installment_status', ['DUE', 'PARTIAL', 'PAID']);
export const paymentModeEnum = pgEnum('payment_mode', ['CASH', 'UPI', 'NEFT', 'CHEQUE', 'CARD']);
export const kycStatusEnum = pgEnum('kyc_status', ['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED']);
export const collateralStatusEnum = pgEnum('collateral_status', ['PLEDGED', 'RELEASED', 'AUCTIONED']);
export const accountTypeEnum = pgEnum('account_type', ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
export const channelEnum = pgEnum('channel', ['VOICE', 'WHATSAPP', 'EMAIL', 'SMS', 'APP']);
export const commStatusEnum = pgEnum('comm_status', ['SCHEDULED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED', 'COMPLETED']);
export const commOutcomeEnum = pgEnum('comm_outcome', ['PROMISE_TO_PAY', 'PAID', 'NO_ANSWER', 'CALLBACK', 'DISPUTE', 'ESCALATED', 'WRONG_NUMBER', 'INFO_ONLY']);
export const viaEnum = pgEnum('via', ['UI', 'CHAT', 'API', 'SYSTEM', 'AGENT', 'BORROWER_APP']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['ISSUED', 'CANCELLED', 'REISSUED']);

export type Role = (typeof roleEnum.enumValues)[number];
export type AssetType = (typeof assetTypeEnum.enumValues)[number];
export type InterestMethod = (typeof interestMethodEnum.enumValues)[number];
export type Frequency = (typeof frequencyEnum.enumValues)[number];
export type LoanStatus = (typeof loanStatusEnum.enumValues)[number];
export type PaymentMode = (typeof paymentModeEnum.enumValues)[number];
export type Channel = (typeof channelEnum.enumValues)[number];
export type Via = (typeof viaEnum.enumValues)[number];

// ---------------------------------------------------------------- tenancy, people
export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  licenseNo: text('license_no'),
  state: text('state').notNull().default('Tamil Nadu'),
  gstin: text('gstin'),
  pan: text('pan'),
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  upiVpa: text('upi_vpa'),
  callWindowStart: integer('call_window_start').notNull().default(8), // local hour, inclusive
  callWindowEnd: integer('call_window_end').notNull().default(19), // local hour, exclusive
  maxContactsPerDay: integer('max_contacts_per_day').notNull().default(2),
  defaultLanguage: text('default_language').notNull().default('en'),
  createdAt: created(),
});

export const branches = pgTable('branches', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  city: text('city'),
  state: text('state'),
  address: text('address'),
  createdAt: created(),
}, (t) => [uniqueIndex('branch_org_code').on(t.orgId, t.code)]);

export const branchTargets = pgTable('branch_targets', {
  id: id(),
  branchId: text('branch_id').notNull().references(() => branches.id),
  month: text('month').notNull(), // YYYY-MM
  disbursalTarget: money('disbursal_target').notNull(),
  collectionTarget: money('collection_target').notNull(),
  incentivePct: pct('incentive_pct').notNull().default('0'),
}, (t) => [uniqueIndex('target_branch_month').on(t.branchId, t.month)]);

export const users = pgTable('users', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  branchId: text('branch_id').references(() => branches.id),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('LOAN_OFFICER'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: created(),
});

// ---------------------------------------------------------------- borrowers & KYC
export const borrowers = pgTable('borrowers', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  branchId: text('branch_id').notNull().references(() => branches.id),
  code: integer('code').notNull(),
  name: text('name').notNull(),
  fatherName: text('father_name'),
  dob: date('dob'),
  gender: text('gender'),
  phone: text('phone').notNull(),
  altPhone: text('alt_phone'),
  email: text('email'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  pincode: text('pincode'),
  language: text('language').notNull().default('en'),
  occupation: text('occupation'),
  monthlyIncome: money('monthly_income'),
  pan: text('pan'),
  aadhaarLast4: text('aadhaar_last4'), // never store a full Aadhaar number
  ckycNo: text('ckyc_no'),
  kycStatus: kycStatusEnum('kyc_status').notNull().default('PENDING'),
  kycVerifiedAt: timestamp('kyc_verified_at', { withTimezone: true }),
  kycDueAt: timestamp('kyc_due_at', { withTimezone: true }),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  consentChannels: text('consent_channels').array().notNull().default([]),
  doNotContact: boolean('do_not_contact').notNull().default(false),
  repaymentScore: integer('repayment_score').notNull().default(600),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('borrower_org_code').on(t.orgId, t.code), index('borrower_org_phone').on(t.orgId, t.phone)]);

export const kycDocuments = pgTable('kyc_documents', {
  id: id(),
  borrowerId: text('borrower_id').notNull().references(() => borrowers.id),
  type: text('type').notNull(), // PAN, AADHAAR, VOTER_ID, PASSPORT, DL, PHOTO, ADDRESS_PROOF
  numberMasked: text('number_masked'),
  documentId: text('document_id'),
  verified: boolean('verified').notNull().default(false),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: created(),
});

export const borrowerOtps = pgTable('borrower_otps', {
  id: id(),
  borrowerId: text('borrower_id').notNull().references(() => borrowers.id),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: created(),
});

// ---------------------------------------------------------------- products & loans
export const products = pgTable('products', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  assetType: assetTypeEnum('asset_type').notNull(),
  interestMethod: interestMethodEnum('interest_method').notNull(),
  frequency: frequencyEnum('frequency').notNull().default('MONTHLY'),
  annualRate: rate('annual_rate').notNull(),
  penalRate: rate('penal_rate').notNull().default('2'),
  minAmount: money('min_amount').notNull().default('1000'),
  maxAmount: money('max_amount').notNull().default('10000000'),
  minTenure: integer('min_tenure').notNull().default(1),
  maxTenure: integer('max_tenure').notNull().default(36),
  maxLtv: pct('max_ltv'),
  ltvTiers: jsonb('ltv_tiers').$type<{ upTo: number; maxLtv: number }[]>(),
  processingFeePct: pct('processing_fee_pct').notNull().default('1'),
  gstRate: pct('gst_rate').notNull().default('18'),
  graceDays: integer('grace_days').notNull().default(3),
  active: boolean('active').notNull().default(true),
  createdAt: created(),
});

export const loans = pgTable('loans', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  branchId: text('branch_id').notNull().references(() => branches.id),
  borrowerId: text('borrower_id').notNull().references(() => borrowers.id),
  productId: text('product_id').notNull().references(() => products.id),
  loanNo: integer('loan_no').notNull(),
  status: loanStatusEnum('status').notNull().default('DRAFT'),
  purpose: text('purpose'),
  principal: money('principal').notNull(),
  annualRate: rate('annual_rate').notNull(),
  penalRate: rate('penal_rate').notNull(),
  interestMethod: interestMethodEnum('interest_method').notNull(),
  frequency: frequencyEnum('frequency').notNull(),
  tenure: integer('tenure').notNull(),
  startDate: date('start_date'),
  maturityDate: date('maturity_date'),
  ltvAtSanction: pct('ltv_at_sanction'),
  collateralValue: money('collateral_value'),
  processingFee: money('processing_fee').notNull().default('0'),
  outstandingPrincipal: money('outstanding_principal').notNull().default('0'),
  interestPaidTo: date('interest_paid_to'),
  totalInterestPaid: money('total_interest_paid').notNull().default('0'),
  totalPenaltyPaid: money('total_penalty_paid').notNull().default('0'),
  dpd: integer('dpd').notNull().default(0),
  officerId: text('officer_id').references(() => users.id),
  approvedById: text('approved_by_id').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('loan_org_no').on(t.orgId, t.loanNo), index('loan_org_status').on(t.orgId, t.status)]);

export const installments = pgTable('installments', {
  id: id(),
  loanId: text('loan_id').notNull().references(() => loans.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  dueDate: date('due_date').notNull(),
  principalDue: money('principal_due').notNull(),
  interestDue: money('interest_due').notNull(),
  principalPaid: money('principal_paid').notNull().default('0'),
  interestPaid: money('interest_paid').notNull().default('0'),
  status: installmentStatusEnum('status').notNull().default('DUE'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
}, (t) => [uniqueIndex('inst_loan_seq').on(t.loanId, t.seq)]);

export const collaterals = pgTable('collaterals', {
  id: id(),
  borrowerId: text('borrower_id').notNull().references(() => borrowers.id),
  loanId: text('loan_id').references(() => loans.id),
  assetType: assetTypeEnum('asset_type').notNull(),
  description: text('description').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  value: money('value').notNull(),
  valuedAt: timestamp('valued_at', { withTimezone: true }).notNull().defaultNow(),
  valuer: text('valuer'),
  valuations: jsonb('valuations').$type<{ date: string; value: number; valuer?: string }[]>().notNull().default([]),
  status: collateralStatusEnum('status').notNull().default('PLEDGED'),
  packetNo: text('packet_no'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdAt: created(),
});

export const guarantors = pgTable('guarantors', {
  id: id(),
  loanId: text('loan_id').notNull().references(() => loans.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  relation: text('relation'),
  address: text('address'),
  pan: text('pan'),
});

export const disbursements = pgTable('disbursements', {
  id: id(),
  loanId: text('loan_id').notNull().references(() => loans.id),
  amount: money('amount').notNull(),
  mode: paymentModeEnum('mode').notNull(),
  reference: text('reference'),
  payee: text('payee'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable('payments', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  loanId: text('loan_id').notNull().references(() => loans.id),
  receiptNo: integer('receipt_no').notNull(),
  amount: money('amount').notNull(),
  mode: paymentModeEnum('mode').notNull(),
  reference: text('reference'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  toPenalty: money('to_penalty').notNull().default('0'),
  toInterest: money('to_interest').notNull().default('0'),
  toPrincipal: money('to_principal').notNull().default('0'),
  collectedById: text('collected_by_id').references(() => users.id),
  via: viaEnum('via').notNull().default('UI'),
  reversed: boolean('reversed').notNull().default(false),
  createdAt: created(),
}, (t) => [uniqueIndex('payment_org_receipt').on(t.orgId, t.receiptNo)]);

export const invoices = pgTable('invoices', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  invoiceNo: integer('invoice_no').notNull(),
  borrowerId: text('borrower_id').notNull().references(() => borrowers.id),
  loanId: text('loan_id').references(() => loans.id),
  kind: text('kind').notNull(), // PROCESSING_FEE, DOCUMENTATION, VALUATION, OTHER
  description: text('description').notNull(),
  amount: money('amount').notNull(), // taxable value
  gstRate: pct('gst_rate').notNull(),
  gstAmount: money('gst_amount').notNull(),
  total: money('total').notNull(),
  status: invoiceStatusEnum('status').notNull().default('ISSUED'),
  replacesId: text('replaces_id'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('invoice_org_no').on(t.orgId, t.invoiceNo)]);

// ---------------------------------------------------------------- accounting
export const accounts = pgTable('accounts', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  type: accountTypeEnum('type').notNull(),
  systemKey: text('system_key'),
  createdAt: created(),
}, (t) => [uniqueIndex('account_org_code').on(t.orgId, t.code), uniqueIndex('account_org_key').on(t.orgId, t.systemKey)]);

export const journalEntries = pgTable('journal_entries', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  branchId: text('branch_id').references(() => branches.id),
  voucherNo: integer('voucher_no').notNull(),
  date: date('date').notNull(),
  narration: text('narration').notNull(),
  sourceType: text('source_type').notNull(), // DISBURSAL, RECEIPT, INVOICE, MANUAL, REVERSAL, WRITE_OFF, AUCTION, EXPENSE
  sourceId: text('source_id'),
  createdById: text('created_by_id'),
  reversalOfId: text('reversal_of_id'),
  createdAt: created(),
}, (t) => [uniqueIndex('je_org_voucher').on(t.orgId, t.voucherNo), index('je_org_date').on(t.orgId, t.date)]);

export const journalLines = pgTable('journal_lines', {
  id: id(),
  entryId: text('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => accounts.id),
  debit: money('debit').notNull().default('0'),
  credit: money('credit').notNull().default('0'),
  loanId: text('loan_id').references(() => loans.id),
  memo: text('memo'),
}, (t) => [index('jl_entry').on(t.entryId), index('jl_account').on(t.accountId)]);

// ---------------------------------------------------------------- conversational AI
export const messageTemplates = pgTable('message_templates', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  key: text('key').notNull(), // DUE_REMINDER, OVERDUE, RECEIPT, STATEMENT, RENEWAL, AUCTION_NOTICE
  language: text('language').notNull(),
  body: text('body').notNull(),
  approved: boolean('approved').notNull().default(false),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: created(),
}, (t) => [uniqueIndex('tpl_org_key_lang').on(t.orgId, t.key, t.language)]);

export const communications = pgTable('communications', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  borrowerId: text('borrower_id').notNull().references(() => borrowers.id),
  loanId: text('loan_id').references(() => loans.id),
  channel: channelEnum('channel').notNull(),
  direction: text('direction').notNull().default('OUT'),
  templateKey: text('template_key'),
  language: text('language').notNull().default('en'),
  content: text('content').notNull(),
  status: commStatusEnum('status').notNull().default('SCHEDULED'),
  blockReason: text('block_reason'),
  outcome: commOutcomeEnum('outcome'),
  ptpDate: date('ptp_date'),
  ptpAmount: money('ptp_amount'),
  transcript: text('transcript'),
  durationSec: integer('duration_sec'),
  provider: text('provider'),
  providerRef: text('provider_ref'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: created(),
}, (t) => [index('comm_org_borrower').on(t.orgId, t.borrowerId, t.createdAt)]);

// ---------------------------------------------------------------- documents, audit, bureau, API
export const documents = pgTable('documents', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  ownerType: text('owner_type').notNull(), // LOAN | BORROWER | COLLATERAL | ORG
  ownerId: text('owner_id').notNull(),
  kind: text('kind').notNull(), // AGREEMENT, KYC, PHOTO, NOTICE, STATEMENT, VALUATION, BUREAU, OTHER
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull(),
  signed: boolean('signed').notNull().default(false),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  signerName: text('signer_name'),
  signature: text('signature'),
  tamperLog: jsonb('tamper_log').$type<{ at: string; action: string; by?: string; sha256: string }[]>().notNull().default([]),
  createdAt: created(),
}, (t) => [index('doc_owner').on(t.ownerType, t.ownerId)]);

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  userId: text('user_id').references(() => users.id),
  via: viaEnum('via').notNull().default('UI'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  summary: text('summary'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_org_at').on(t.orgId, t.at), index('audit_entity').on(t.entity, t.entityId)]);

export const bureauSubmissions = pgTable('bureau_submissions', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  bureau: text('bureau').notNull(),
  periodEnd: date('period_end').notNull(),
  recordCount: integer('record_count').notNull(),
  documentId: text('document_id'),
  status: text('status').notNull().default('GENERATED'),
  createdAt: created(),
});

export const apiKeys = pgTable('api_keys', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  hash: text('hash').notNull().unique(),
  lastUsed: timestamp('last_used', { withTimezone: true }),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: created(),
});

export const counters = pgTable('counters', {
  orgId: text('org_id').notNull().references(() => organizations.id),
  key: text('key').notNull(), // BORROWER | LOAN | RECEIPT | INVOICE | VOUCHER
  value: integer('value').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.orgId, t.key] })]);

export const chatThreads = pgTable('chat_threads', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull().default('New chat'),
  createdAt: created(),
});

export const chatMessages = pgTable('chat_messages', {
  id: id(),
  threadId: text('thread_id').notNull().references(() => chatThreads.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant
  content: jsonb('content').notNull(), // Anthropic content blocks
  pending: jsonb('pending'), // an action awaiting confirmation
  createdAt: created(),
});
