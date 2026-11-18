import { doc, increment, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { ledgerCollectionForPortfolioKind, fundingDocumentId } from '../domain/finance/portfolioFundingService';
import { portfolioRef } from '../domain/finance/portfolioFirestore';
import type { FinancialPortfolio } from '../domain/finance/financialPortfolio';
import {
  calculateReceivableSettlement, isReceivableDestination, normalizeReceivableSettlement,
  RECEIVABLE_COLLECTION_SOURCE, RECEIVABLE_SETTLEMENTS, replayReceivableSettlement,
  type ReceivableSettlementIntent
} from '../domain/finance/receivableSettlement';
import type { ManagementPaymentAccount } from './managementCashPosting';
import { kampalaBusinessDate } from '../utils/eodBusinessDate';

/** The request record is globally unique. The four writes share one transaction and a rules-checked chain. */
export async function settleCreditReceivable(raw: ReceivableSettlementIntent, database: Firestore = db) {
  const input = normalizeReceivableSettlement(raw);
  const { tenantId, receivableId, destinationAccountId, actorId, amountUGX, reference, requestId } = input;
  if (database === db && auth.currentUser?.uid !== actorId) throw new Error('Sign in as the processing Finance user.');
  const paymentRef = doc(database, RECEIVABLE_SETTLEMENTS, requestId);
  const receivableRef = doc(database, 'credit_receivables', receivableId);
  const accountRef = doc(database, 'finance_payment_accounts', fundingDocumentId(tenantId, destinationAccountId));
  return runTransaction(database, async tx => {
    const prior = await tx.get(paymentRef);
    if (prior.exists()) return replayReceivableSettlement(input, prior.data());

    const [record, destination] = await Promise.all([tx.get(receivableRef), tx.get(accountRef)]);
    const row = record.data();
    if (!row || row.tenantId !== tenantId) throw new Error('The canonical receivable is unavailable.');
    const branchId = String(row.branch_id || row.branchId || '');
    const account = destination.data() as ManagementPaymentAccount | undefined;
    const registered = /^(bank_|custom_)/.test(destinationAccountId)
      ? (await tx.get(portfolioRef(database, tenantId, destinationAccountId))).data() as FinancialPortfolio | undefined
      : undefined;
    if (!account || account.accountId !== destinationAccountId ||
      !isReceivableDestination(account, tenantId, branchId, registered)) {
      throw new Error('Choose an active, initialized receiving account for this branch or organisation.');
    }
    if (!Number.isSafeInteger(account.balanceUGX + amountUGX)) throw new Error('The receiving account would exceed its balance limit.');
    const sourceSaleId = String(row.receipt_id || row.saleId || '');
    const invoiceId = String(row.invoiceId || row.invoice_id || '');
    if (!sourceSaleId && !invoiceId) throw new Error('Reconcile the original sale or invoice before collecting this receivable.');
    const { before, after, status } = calculateReceivableSettlement(row, amountUGX);
    const movementId = 'receivable_payment_' + requestId;
    const movementRef = doc(database, ledgerCollectionForPortfolioKind(account.kind), movementId);
    const date = kampalaBusinessDate();
    const recordedAt = serverTimestamp();
    const invoiceNumber = String(row.invoice_number || row.receiptNumber || '');
    const customerId = String(row.debtorId || row.institution_id || row.client_id || '');
    const customerName = String(row.client_name || row.institution_name || '');
    tx.set(paymentRef, {
      ...input, settlementId: requestId, branchId, sourceSaleId, originalSaleId:String(row.originalSaleId || sourceSaleId),
      invoiceId, invoiceNumber, customerId, customerName,
      outstandingBeforeUGX: before, outstandingAfterUGX: after, destinationPortfolio: account.portfolioClassification,
      destinationKind: account.kind, destinationName: account.name, accountDocumentId: accountRef.id,
      movementId, date, recordedAt
    });
    tx.set(movementRef, {
      tenantId, branchId, portfolioId: destinationAccountId, accountDocumentId: accountRef.id,
      accountDeltaUGX: amountUGX, amount: amountUGX, type: 'incoming', source: RECEIVABLE_COLLECTION_SOURCE,
      reference_number: reference, receivableSettlementId: requestId, receivableId, invoiceNumber,
      postedBy: actorId, date, createdAt: recordedAt, updatedAt: recordedAt
    });
    tx.update(accountRef, { balanceUGX: increment(amountUGX), lastPostingId: movementId, updatedAt: recordedAt });
    tx.update(receivableRef, { outstanding_ugx: after, status, lastSettlementId: requestId, lastProcessedAt: recordedAt });
    return { settlementId: requestId, remainingUGX: after, replayed: false };
  });
}
