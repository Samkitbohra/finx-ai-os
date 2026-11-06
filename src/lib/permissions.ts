import type { Role } from '@/db/schema';

export type Action =
  | 'read'
  | 'borrower.write'
  | 'loan.create'
  | 'loan.approve'
  | 'loan.disburse'
  | 'loan.writeoff'
  | 'payment.record'
  | 'payment.reverse'
  | 'collateral.manage'
  | 'invoice.write'
  | 'journal.write'
  | 'comms.send'
  | 'compliance.run'
  | 'settings.write'
  | 'users.write';

const ALL: Action[] = [
  'read', 'borrower.write', 'loan.create', 'loan.approve', 'loan.disburse', 'loan.writeoff', 'payment.record',
  'payment.reverse', 'collateral.manage', 'invoice.write', 'journal.write', 'comms.send', 'compliance.run',
  'settings.write', 'users.write',
];

export const ROLE_ACTIONS: Record<Role, Action[]> = {
  OWNER: ALL,
  ADMIN: ALL,
  BRANCH_MANAGER: ['read', 'borrower.write', 'loan.create', 'loan.approve', 'loan.disburse', 'payment.record', 'payment.reverse', 'collateral.manage', 'invoice.write', 'comms.send', 'compliance.run'],
  LOAN_OFFICER: ['read', 'borrower.write', 'loan.create', 'payment.record', 'collateral.manage', 'comms.send'],
  ACCOUNTANT: ['read', 'payment.record', 'payment.reverse', 'invoice.write', 'journal.write', 'compliance.run'],
  COLLECTOR: ['read', 'payment.record', 'comms.send'],
  AUDITOR: ['read'],
};

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Owner', ADMIN: 'Admin', BRANCH_MANAGER: 'Branch manager', LOAN_OFFICER: 'Loan officer',
  ACCOUNTANT: 'Accountant', COLLECTOR: 'Collections', AUDITOR: 'Auditor (read-only)',
};

export const can = (role: Role, action: Action) => ROLE_ACTIONS[role].includes(action);

/** Roles that see every branch; others are limited to their own. */
export const ORG_WIDE: Role[] = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'AUDITOR'];

export class Forbidden extends Error {
  status = 403;
  constructor(action: Action) { super(`Your role is not allowed to do this (${action}).`); }
}

export class UserError extends Error {
  status = 400;
}
