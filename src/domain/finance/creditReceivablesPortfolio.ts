import { isBusinessDate, kampalaBusinessDate, timestampBusinessDate } from '../../utils/eodBusinessDate';
import { isActiveSale } from '../../utils/activeSales';
import { approvedDueDate, isCreditMethod } from './creditRecognition';
import {sumEodAmounts} from '../../utils/eodMoney';
export type CreditSourceRecord = {id:string;[key:string]:unknown};
export interface PortfolioReceivable {
 id:string;reference:string;client:string;branchId:string;businessDate:string;
 originalUGX:number;outstandingUGX:number;status:string;
 dueDate:string;debtorId:string;debtorType:'client'|'institution';sourceId:string;
 reversalDate:string;reversedUGX:number;refundDueUGX:number;canCollect:boolean;carriedUGX:number;recognizedDate:string;
}
export interface ReceivableRepayment {
 id:string;receivableId:string;reference:string;businessDate:string;amountUGX:number;destination:string;
}
function money(value:unknown, recordId:string, field:string):number {
 if(typeof value!=='number'||!Number.isFinite(value)||value>Number.MAX_SAFE_INTEGER||value<0)throw Error(`Invalid UGX amount in ${field} on credit record ${recordId}.`);
 return value;
}
export function receivableDate(value:unknown):string {
 const raw=value as {toDate?:()=>Date}|null;
 if (value instanceof Date) return Number.isFinite(value.getTime()) ? kampalaBusinessDate(value) : '';
 if(typeof raw?.toDate==='function') return receivableDate(raw.toDate());
 if(typeof value!=='string') return '';
 return isBusinessDate(value) ? value : timestampBusinessDate(value) ?? '';
}
/** Saved credit obligations only. Invoices and POS evidence are never added a second time. */
export function projectCreditReceivables(tenantId:string,records:readonly CreditSourceRecord[],payments:readonly CreditSourceRecord[]=[]) {
 const ids=new Set<string>(),receipts=new Set<string>();
 const rows:PortfolioReceivable[]=records.map(raw=>{
  if(!raw.id||raw.tenantId!==tenantId||ids.has(raw.id))throw Error('Duplicate or out-of-tenant receivable.');
  ids.add(raw.id);
  const receipt=String(raw.receipt_id||raw.saleId||raw.invoiceId||raw.invoice_id||'');
  if(receipt&&receipts.has(receipt))throw Error('Multiple saved receivables reference the same sale. Reconcile duplicates before using this portfolio balance.');
  if(receipt)receipts.add(receipt);
  const originalUGX=money(raw.amount_ugx,raw.id,'amount_ugx');
  const status=String(raw.status||'outstanding').toLowerCase();
  const outstandingUGX=money(raw.outstanding_ugx??(status==='paid'?0:originalUGX),raw.id,'outstanding_ugx');
  if(outstandingUGX>originalUGX)throw Error('Receivable outstanding exceeds its original credit amount.');
  if(['paid','reversed','voided'].includes(status)&&outstandingUGX!==0)throw Error('Paid receivable has a nonzero outstanding balance.');
  const businessDate=receivableDate(raw.created_at||raw.createdAt);
  const explicitDueDate=receivableDate(raw.due_date||raw.dueDate);
  const historicalPlaceholder = raw.source==='POS' && raw.controlVersion!==2 && explicitDueDate===businessDate;
  const dueDate=(!historicalPlaceholder && explicitDueDate)
    || approvedDueDate(businessDate, typeof raw.credit_terms==='string'?raw.credit_terms:null) || '';
  const debtorType=raw.debtorType==='institution'||raw.institution_id?'institution':'client';
  return {id:raw.id,reference:String(raw.invoice_number||raw.receiptNumber||'Credit issued'),client:String(raw.client_name||raw.institution_name||'Unspecified customer'),
   branchId:String(raw.branch_id||raw.branchId||''),businessDate,originalUGX,outstandingUGX,
   dueDate, recognizedDate:receivableDate(raw.createdAt)||businessDate,
   carriedUGX:typeof raw.carriedCollectionsUGX==='number'?raw.carriedCollectionsUGX:0, debtorType, debtorId:String(raw.debtorId||raw.institution_id||raw.client_id||''),sourceId:receipt,
   reversalDate:receivableDate(raw.reversedAt),reversedUGX:typeof raw.reversedAmount==='number'?raw.reversedAmount:0,
   refundDueUGX:typeof raw.refundDueUGX==='number'?raw.refundDueUGX:0,
   canCollect:!!receipt && typeof raw.outstanding_ugx==='number' && outstandingUGX>=1 && !['reversed','voided','paid'].includes(status),
   status:status==='outstanding'&&outstandingUGX>0&&outstandingUGX<originalUGX?'partial':status};
 });
 const paymentIds=new Set<string>();
 const repayments:ReceivableRepayment[]=payments.filter(p=>p.receivableId&&ids.has(String(p.receivableId))).map(p=>{
  if(p.tenantId!==tenantId||paymentIds.has(p.id)||(p.fromPortfolio!=='receivables'&&p.settlementId!==p.id))throw Error('Invalid receivable repayment record.');
  paymentIds.add(p.id);
  return {id:p.id,receivableId:String(p.receivableId),reference:String(p.reference||p.reference_number||'Credit repayment'),businessDate:receivableDate(p.recordedAt||p.processedAt||p.createdAt),
   amountUGX:money(p.amountUGX??p.amount,p.id,'amount'),destination:String(p.destinationName||(p.toPortfolio==='banked'?'Management Bank':'Historical account'))};
 });
 const totalOutstandingUGX=sumEodAmounts(rows.map(row=>row.outstandingUGX));
 if(totalOutstandingUGX>Number.MAX_SAFE_INTEGER)throw Error('Receivables balance overflow.');
 return {rows,repayments,totalOutstandingUGX};
}

export const ageingBuckets = ['Not yet due', '1 to 30 days', '31 to 60 days', '61 to 90 days', 'Over 90 days', 'Terms missing'] as const;

export function receivableAgeing(dueDate: string, reportDate: string) {
  if (!isBusinessDate(dueDate) || !isBusinessDate(reportDate)) return ageingBuckets[5];
  const days = (Date.parse(reportDate) - Date.parse(dueDate)) / 86_400_000;
  return ageingBuckets[days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4];
}

export function receivableBalanceAt(row: PortfolioReceivable, repayments: ReceivableRepayment[], date: string, today: string) {
  if (date >= today) return row.outstandingUGX;
  if (!row.recognizedDate) return null;
  if (row.recognizedDate > date) return 0;
  const relevant = repayments.filter(payment => payment.receivableId === row.id);
  const allCollections = sumEodAmounts(relevant.map(payment => payment.amountUGX));
  const reversed = ['reversed', 'voided'].includes(row.status);
  if (relevant.some(payment => !payment.businessDate) || (reversed && !row.reversalDate) ||
    Math.abs(row.originalUGX - row.carriedUGX - row.reversedUGX - allCollections - row.outstandingUGX) > 0.0001) return null;
  if (reversed && row.reversalDate <= date) return 0;
  return sumEodAmounts([row.originalUGX, -row.carriedUGX, ...relevant.filter(payment => payment.businessDate <= date).map(payment => -payment.amountUGX)]);
}

export interface ReceivableException {
  id: string;
  reference: string;
  branchId: string;
  detail: string;
}

/** Keep ambiguous balances out of the live register and expose their original references for review. */
export function inspectReceivables(tenantId: string, records: CreditSourceRecord[], payments: CreditSourceRecord[],
  sales: CreditSourceRecord[], movements?: CreditSourceRecord[], debtors?: Record<'client'|'institution', CreditSourceRecord[]>) {
  const exceptions: ReceivableException[] = [];
  const sourceOf = (row: CreditSourceRecord) => String(row.receipt_id || row.saleId || row.invoiceId || row.invoice_id || '');
  const counts = new Map<string, number>();
  records.forEach(row => {
    const source = sourceOf(row);
    if (source) counts.set(source, (counts.get(source) || 0) + 1);
  });
  const linked = new Set(records.flatMap(row => [row.id, sourceOf(row)].filter(Boolean)));
  const salesById = new Map(sales.map(row => [row.id, row]));
  const saved = records.filter(row => {
    const source = sourceOf(row);
    const sale = salesById.get(source);
    const branchId = String(row.branch_id || row.branchId || '');
    let detail = '';
    if (!source) detail = 'Original sale or invoice link is missing.';
    else if (typeof row.outstanding_ugx !== 'number' && String(row.status).toLowerCase() !== 'paid') detail = 'Outstanding balance is missing.';
    else if ((counts.get(source) || 0) > 1) detail = 'Duplicate saved records share this source.';
    else if (sale && (sale.branchId !== branchId || (row.paymentId && sale.canonicalPaymentId && row.paymentId !== sale.canonicalPaymentId))) {
      detail = 'Saved credit disagrees with the source receipt.';
    } else {
      try { projectCreditReceivables(tenantId, [row]); }
      catch (error) { detail = error instanceof Error ? error.message : 'Invalid saved record.'; }
    }
    if (detail) exceptions.push({id:row.id, reference:String(row.invoice_number || row.receiptNumber || row.id), branchId, detail});
    return !detail;
  });
  for (const sale of sales) {
    if (isActiveSale(sale as Parameters<typeof isActiveSale>[0]) && !linked.has(sale.id) && [sale.paymentMethod, sale.secondaryPaymentMethod].some(isCreditMethod)) {
      exceptions.push({id:'sale_'+sale.id, reference:String(sale.receiptNumber || sale.id),
        branchId:String(sale.branchId || ''), detail:'POS credit receipt has no saved receivable.'});
    }
  }
  const movementById = new Map(movements?.map(move => [move.id, move]));
  const recordIds = new Set(records.map(row => row.id));
  const paymentById = new Map(payments.map(payment => [payment.id,payment]));
  for (const movement of movements || []) {
    if (movement.receivableSettlementId && !paymentById.has(String(movement.receivableSettlementId))) {
      exceptions.push({id:'movement_'+movement.id,reference:String(movement.reference_number||'Credit collection'),
        branchId:String(movement.branchId||''),detail:'Receiving-account movement has no linked settlement.'});
    }
  }
  const selectedPayments = payments.filter(payment => {
    const amount = payment.amountUGX ?? payment.amount;
    const valid = payment.tenantId === tenantId && typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
    const movement = movementById.get(String(payment.movementId || payment.bankMovementId || ''));
    if (!valid || !recordIds.has(String(payment.receivableId)) || (movements && (
      !movement || movement.tenantId !== tenantId || movement.amount !== amount || movement.accountDeltaUGX !== amount ||
      (payment.settlementId ? movement.receivableSettlementId !== payment.id || movement.accountDocumentId !== payment.accountDocumentId
        : movement.transferId !== payment.id)))) {
      exceptions.push({id:'payment_'+payment.id, reference:String(payment.reference || payment.invoiceNumber || 'Recorded repayment'),
        branchId:String(payment.branchId || ''), detail:'Repayment needs reconciliation with the receivable and receiving-account movement.'});
    }
    return valid;
  });
  const data = projectCreditReceivables(tenantId, saved, selectedPayments);
  const collectionsByDebt = new Map<string, number>();
  for (const payment of data.repayments) collectionsByDebt.set(payment.receivableId,
    sumEodAmounts([collectionsByDebt.get(payment.receivableId) || 0, payment.amountUGX]));
  for (const row of data.rows) {
    if (Math.abs(row.originalUGX - row.carriedUGX - row.reversedUGX - row.outstandingUGX - (collectionsByDebt.get(row.id) || 0)) > 0.0001) {
      exceptions.push({id:'balance_'+row.id, reference:row.reference, branchId:row.branchId, detail:'Saved balance and recorded repayment history differ.'});
    }
  }
  if (debtors) {
    for (const type of ['client', 'institution'] as const) {
      const expected = new Map<string, number>();
      const masters = new Map(debtors[type].map(debtor => [debtor.id, debtor]));
      for (const row of data.rows.filter(row => row.debtorType === type && row.outstandingUGX > 0)) {
        if (!row.debtorId || !masters.has(row.debtorId)) {
          exceptions.push({id:'debtor_'+row.id, reference:row.reference, branchId:row.branchId, detail:'Match this balance to its CRM customer or institution.'});
        } else expected.set(row.debtorId, sumEodAmounts([expected.get(row.debtorId) || 0, row.outstandingUGX]));
      }
      for (const debtor of debtors[type]) {
        const stored = debtor.receivablesBalanceUGX ?? debtor.credit_balance_ugx ?? debtor.creditBalance ?? debtor.outstanding_balance;
        const balance = expected.get(debtor.id) || 0;
        if (stored != null && (typeof stored !== 'number' || !Number.isFinite(stored) || Math.abs(stored - balance) > 0.0001)) {
          exceptions.push({id:type+'_'+debtor.id, reference:String(debtor.full_name || debtor.supplier_name || debtor.name || debtor.id),
            branchId:'', detail:`CRM shows ${String(stored)} UGX. The register shows ${balance.toLocaleString()} UGX. Check the underlying obligations and adjustments.`});
        }
      }
    }
  }
  return { ...data, exceptions };
}
