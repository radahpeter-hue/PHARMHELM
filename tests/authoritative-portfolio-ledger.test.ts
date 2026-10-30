import test from 'node:test';
import assert from 'node:assert/strict';
import {mapAuthoritativeMovement,managementLedgerCollection} from '../src/domain/finance/authoritativePortfolioLedger';
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
