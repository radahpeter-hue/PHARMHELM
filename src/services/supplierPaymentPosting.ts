import { doc, getDoc, serverTimestamp, type Firestore, type Transaction } from 'firebase/firestore';
import { canSettleSupplierInvoices, eligibleSupplierFunding, isRegisteredSupplierPortfolio, supplierAccountDebit, type SupplierFundingAccount } from '../domain/finance/supplierPaymentPolicy';
import { auth, db } from '../firebase';
import { portfolioRef } from '../domain/finance/portfolioFirestore';
import { ledgerCollectionForPortfolioKind } from '../domain/finance/portfolioFundingService';
import { kampalaBusinessDate } from '../utils/eodBusinessDate';
import { managementAccountDocumentId, stageManagementCashEntry } from './managementCashPosting';

export interface SupplierPaymentInput {
  tenantId: string;
  draftId: string;
  requestId: string;
  amountUGX: number;
  chargeUGX?: number;
  externalReference: string;
  paymentAccountId: string;
  actor: { uid: string; name: string };
}

export function validateSupplierPayment(input: SupplierPaymentInput) {
  const externalReference = input.externalReference.trim();
  if (![input.tenantId, input.requestId, input.paymentAccountId, input.actor.uid]
    .every(id => /^[A-Za-z0-9_-]{1,150}$/.test(id)) || !/^[A-Za-z0-9_-]{1,400}$/.test(input.draftId) || externalReference.length < 3 || externalReference.length > 150) {
    throw new Error('Invalid supplier payment reference or identity.');
  }
  const chargeUGX = input.chargeUGX ?? 0;
  return { ...input, externalReference, chargeUGX, totalDebitUGX: supplierAccountDebit(input.amountUGX, chargeUGX) };
}

type Payment = ReturnType<typeof validateSupplierPayment>;

function assertSupplierActor(connection: Firestore, uid: string) {
  if (connection === db && auth.currentUser?.uid !== uid) {
    throw new Error('The supplier payment must use the signed-in Finance account.');
  }
}

export async function readSupplierPayer(tx: Transaction, connection: Firestore, input: Pick<Payment, 'tenantId' | 'actor'>) {
  assertSupplierActor(connection, input.actor.uid);
  const staff = (await tx.get(doc(connection, 'staff', input.actor.uid))).data();
  if (!canSettleSupplierInvoices(staff, input.tenantId)) {
    throw new Error('Only authorized HQ Finance personnel can record supplier payments.');
  }
  return { name: String(staff?.full_name || staff?.fullName || staff?.displayName || input.actor.name) };
}

export async function readSupplierFunding(tx: Transaction, connection: Firestore, input: Payment, movementId: string) {
  const { tenantId, paymentAccountId, chargeUGX, totalDebitUGX } = input;
  const account = (await tx.get(doc(connection, 'finance_payment_accounts',
    managementAccountDocumentId(tenantId, paymentAccountId)))).data() as SupplierFundingAccount | undefined;
  const portfolio = isRegisteredSupplierPortfolio(paymentAccountId)
    ? (await tx.get(portfolioRef(connection, tenantId, paymentAccountId))).data() : undefined;
  if (!account || account.accountId !== paymentAccountId || !eligibleSupplierFunding(account, tenantId, portfolio)) {
    throw new Error('Select an active, reconciled financial account eligible for supplier payments.');
  }
  const fundingBranchId = account.scope?.branchId || '';
  const branch = fundingBranchId ? (await tx.get(doc(connection, 'branches', fundingBranchId))).data() : undefined;
  if (fundingBranchId && (!branch || branch.tenantId !== tenantId || ['Inactive', 'Closed'].includes(branch.status))) {
    throw new Error('The funding account must belong to an active branch in this tenant.');
  }
  if (account.balanceUGX < totalDebitUGX) throw new Error('Insufficient funds for the supplier payment and charge.');
  const collection = ledgerCollectionForPortfolioKind(account.kind);
  const chargeMovementId = chargeUGX ? movementId + '_fee' : '';
  const movements = await Promise.all([movementId, ...(chargeMovementId ? [chargeMovementId] : [])]
    .map(id => tx.get(doc(connection, collection, id))));
  if (movements.some(movement => movement.exists())) {
    throw new Error('A ledger movement already exists for this payment reference. Reconcile before retrying.');
  }
  return {
    paymentAccountId, paymentAccountKind: account.kind, fundingAccountName: account.name,
    fundingBranchId, fundingBranchName: String(branch?.name || branch?.branch_name || fundingBranchId),
    movementId, chargeMovementId, chargeUGX, totalDebitUGX,
  };
}

export function stageSupplierPayment(
  tx: Transaction, connection: Firestore, input: Payment, funding: Awaited<ReturnType<typeof readSupplierFunding>>,
  link: { paymentId: string; invoiceId: string; grnId: string; creditLedgerId?: string; supplierPosting: 'cash' | 'credit'; reference: string },
) {
  const { reference, ...references } = link;
  const movement = {
    ...references, tenantId: input.tenantId, date: kampalaBusinessDate(), type: 'outgoing',
    reference_number: reference, externalReference: input.externalReference,
    paymentAccountId: funding.paymentAccountId, fundingBranchId: funding.fundingBranchId,
    ...(funding.fundingBranchId ? { branchId: funding.fundingBranchId } : {}),
    logged_by: input.actor.uid, excludeFromOpexRollup: true,
  };
  stageManagementCashEntry(tx, funding.movementId, {
    ...movement, amount: input.amountUGX, supplierCharge: false,
    source: link.supplierPosting === 'cash' ? 'Procurement Cash GRN settlement' : 'Supplier credit settlement',
  }, connection, input.paymentAccountId, input.actor.uid, {
    kind: funding.paymentAccountKind,
    charge: funding.chargeMovementId ? {
      id: funding.chargeMovementId,
      data: { ...movement, amount: funding.chargeUGX, supplierCharge: true,
        source: 'Supplier payment transaction charge', expenseCategory: 'Financial service expenses', excludeFromOpexRollup: false },
    } : undefined,
  });
}

export function supplierPaymentAudit(input: Payment, payer: { name: string }) {
  return {
    tenantId: input.tenantId, draftId: input.draftId, requestId: input.requestId,
    externalReference: input.externalReference, processedBy: input.actor.uid,
    processedByName: payer.name, processedAt: serverTimestamp(), status: 'posted', excludeFromOpexRollup: true,
  };
}

export function checkSupplierPaymentReplay(data: Record<string, unknown>, input: Payment) {
  if (data.tenantId !== input.tenantId || data.draftId !== input.draftId ||
      (data.amountUGX ?? data.amount) !== input.amountUGX || (data.chargeUGX ?? 0) !== input.chargeUGX ||
      data.processedBy !== input.actor.uid || data.paymentAccountId !== input.paymentAccountId ||
      data.externalReference !== input.externalReference) {
    throw new Error('Settlement reference already belongs to a different payment.');
  }
  return Number(data.remainingUGX ?? data.balanceAfter);
}

export async function recoverSupplierPayment(connection: Firestore, collection: string, paymentId: string, input: Payment, error: unknown) {
  // An immutable-create race can surface a rules denial before the SDK retries.
  assertSupplierActor(connection, input.actor.uid);
  const staff = await getDoc(doc(connection, 'staff', input.actor.uid)).catch(() => null);
  if (canSettleSupplierInvoices(staff?.data(), input.tenantId)) {
    const recorded = await getDoc(doc(connection, collection, paymentId)).catch(() => null);
    if (recorded?.exists()) {
      return { paymentId, alreadyProcessed: true, remainingUGX: checkSupplierPaymentReplay(recorded.data(), input) };
    }
    const account = await getDoc(doc(connection, 'finance_payment_accounts',
      managementAccountDocumentId(input.tenantId, input.paymentAccountId))).catch(() => null);
    if (account?.data()?.tenantId === input.tenantId && account.data()?.balanceUGX < input.totalDebitUGX) {
      throw new Error('Insufficient funds for the supplier payment and charge.');
    }
  }
  throw error;
}
