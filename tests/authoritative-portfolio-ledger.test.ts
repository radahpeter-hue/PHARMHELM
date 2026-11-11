import test from 'node:test';
import assert from 'node:assert/strict';
import {mapAuthoritativeMovement,managementLedgerCollection,assertAuthoritativePostingBalance} from '../src/domain/finance/authoritativePortfolioLedger';
import {MANAGEMENT_BANK_ACCOUNT,MANAGEMENT_CASH_ACCOUNT,type ManagementPaymentAccount} from '../src/services/managementCashPosting';
const account=(id:string,kind:'bank'|'petty_cash'):ManagementPaymentAccount=>({
 id:'tenant_a_'+id,tenantId:'tenant_a',accountId:id,name:'Account',kind,currency:'UGX',
 initialized:true,balanceUGX:100,openingBalanceUGX:50,reconciliationReference:'STATEMENT-001'
});
test('Authoritative Finance movements preserve account and posting direction',()=>{
 const bank=account(MANAGEMENT_BANK_ACCOUNT,'bank');
 assert.equal(managementLedgerCollection(bank),'banking_records');
 const entry=mapAuthoritativeMovement('evt1',{tenantId:'tenant_a',accountDocumentId:bank.id,amount:100,accountDeltaUGX:-100,date:'2026-10-29',postedBy:'ceo'},bank);
 assert.equal(entry.direction,'outflow');assert.equal(entry.amountUGX,100);
 assert.equal(entry.portfolioId,MANAGEMENT_BANK_ACCOUNT);
});
test('Finance projection rejects cross-tenant and inconsistent ledger amounts',()=>{
 const cash=account(MANAGEMENT_CASH_ACCOUNT,'petty_cash');
 assert.equal(managementLedgerCollection(cash),'petty_cash_ledger');
 assert.throws(()=>mapAuthoritativeMovement('evt',{tenantId:'other',accountDocumentId:cash.id,amount:100,accountDeltaUGX:100,date:'2026-10-29'},cash),/does not belong/);
 assert.throws(()=>mapAuthoritativeMovement('evt',{tenantId:'tenant_a',accountDocumentId:cash.id,amount:150,accountDeltaUGX:100,date:'2026-10-29'},cash),/Unverified/);
});

test('complete linked posting history reconciles independently funded bank and branch accounts',()=>{
 const bank={...account('bank_'+'a'.repeat(64),'bank'),portfolioId:'bank_'+'a'.repeat(64),openingBalanceUGX:100,balanceUGX:170};
 const make=(id:string,amount:number,direction:'inflow'|'outflow')=>({
  id,tenantId:bank.tenantId,portfolioId:bank.accountId,accountId:bank.accountId,
  businessDate:'2026-10-30',occurredAt:'2026-10-30T12:00:00Z',
  reference:id,description:id,source:'banking_records',direction,amountUGX:amount,actorId:'ceo',status:'posted' as const
 });
 const entries=[make('deposit',100,'inflow'),make('payment',30,'outflow')];
 assert.doesNotThrow(()=>assertAuthoritativePostingBalance(bank,entries));
 assert.throws(()=>assertAuthoritativePostingBalance({...bank,balanceUGX:171},entries),/does not reconcile/);
 assert.throws(()=>assertAuthoritativePostingBalance(bank,[...entries,entries[0]]),/duplicate/);
 assert.throws(()=>assertAuthoritativePostingBalance(bank,[{...entries[0],tenantId:'foreign'}]),/Invalid or duplicate/);
});


test('supplier debits expose the business reference and retain the immutable payment link', () => {
  const bank = account(MANAGEMENT_BANK_ACCOUNT, 'bank');
  const paymentId = 'supplier_credit_settlement_' + 'a'.repeat(64);
  const entry = mapAuthoritativeMovement('credit_payment_' + paymentId + '_fee', {
    tenantId: bank.tenantId, accountDocumentId: bank.id, amount: 100, accountDeltaUGX: -100,
    date: '2026-11-11', postedBy: 'finance', supplierPosting: 'credit', supplierCharge: true,
    paymentId, externalReference: 'BANK-0451', reference_number: 'CP-' + 'a'.repeat(64),
  }, bank);
  assert.equal(entry.reference, 'BANK-0451');
  assert.equal(entry.linkedRecordId, paymentId);
  assert.equal(entry.transferClass, undefined);
});
