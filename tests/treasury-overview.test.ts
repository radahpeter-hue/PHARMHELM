import test from 'node:test';
import assert from 'node:assert/strict';
import {treasuryPositions,verifiedLiquidPosition,DEFAULT_TREASURY_PORTFOLIOS} from '../src/domain/finance/treasuryOverview';
import {defineFinancialPortfolio} from '../src/domain/finance/financialPortfolio';
import type {ManagementPaymentAccount} from '../src/services/managementCashPosting';
import {mapAuthoritativeMovement} from '../src/domain/finance/authoritativePortfolioLedger';
const tenantId='tenant_a';
const bank=defineFinancialPortfolio({tenantId,id:'bank_'+'a'.repeat(64),name:'Test Bank',classification:'bank',description:'Test',origin:'custom',scope:{kind:'organisation'},currency:'UGX',supportsChildAccounts:false,allowsTransfersIn:false,allowsTransfersOut:false,createdBy:'owner',createdAt:'2026-11-01T00:00:00Z',bankParentId:'system_bank',bankInstitution:'Test',bankAccountReference:'1234'});
const account=(id:string,value=100):ManagementPaymentAccount=>({id:tenantId+'_'+id,tenantId,accountId:id,portfolioId:id,name:id,kind:id.startsWith('system_branch_cash')||id.startsWith('system_petty_cash')||id==='management_petty_cash'?'petty_cash':'bank',currency:'UGX',initialized:true,balanceUGX:value,openingBalanceUGX:0,reconciliationReference:'VERIFIED-OPENING'});
const accounts=['system_branch_cash_sales_b1','system_petty_cash_b1','system_mtn_mobile_money','system_airtel_mobile_money',bank.id].map(id=>account(id));
const input={tenantId,branches:[{id:'b1'}],portfolios:[bank],accounts};
test('Treasury presents seven categories and never creates accounts for credit or welfare',()=>{
 const positions=treasuryPositions(input);
 assert.deepEqual(positions.map(p=>p.name),['Branch Cash Sales','Airtel Money','MTN Money','Bank','Credit Receivables','Petty Cash','Staff Welfare Fund']);
 assert.equal(DEFAULT_TREASURY_PORTFOLIOS.length,7);
 assert.deepEqual(positions.map(p=>p.balanceUGX),[100,100,100,100,null,100,null]);
 assert.equal(verifiedLiquidPosition(positions).balanceUGX,500);
 assert.equal(positions.find(p=>p.id==='welfare')!.accounts.length,0);
});
test('Treasury reports a partial verified subtotal and never makes absent accounts zero',()=>{
 const positions=treasuryPositions({...input,accounts:accounts.filter(a=>a.accountId!=='system_airtel_mobile_money')});
 assert.equal(positions.find(p=>p.id==='airtel')!.balanceUGX,null);
 assert.deepEqual(verifiedLiquidPosition(positions),{balanceUGX:400,verifiedCount:4,totalCount:5,complete:false});
 assert.equal(treasuryPositions({...input,branches:[{id:'b1'},{id:'b2'}]}).find(p=>p.id==='cash')!.balanceUGX,null);
});
test('Treasury includes Management Cash once in Petty Cash and excludes restricted custom funds',()=>{
 const positions=treasuryPositions({...input,accounts:[...accounts,account('management_petty_cash',200),{...account('custom_fund',900),kind:'petty_cash',portfolioClassification:'restricted_internal_fund'}]});
 assert.equal(positions.find(p=>p.id==='petty')!.balanceUGX,300);
 assert.equal(verifiedLiquidPosition(positions).balanceUGX,700);
});
test('Treasury isolates tenants, rejects duplicate mappings and invalid balances',()=>{
 assert.equal(verifiedLiquidPosition(treasuryPositions({...input,accounts:[...accounts,{...account('system_airtel_mobile_money',999999),tenantId:'other'}]})).balanceUGX,500);
 assert.throws(()=>treasuryPositions({...input,accounts:[...accounts,accounts[0]]}),/Duplicate/);
 for(const override of [{initialized:false},{balanceUGX:NaN},{openingBalanceUGX:NaN},{reconciliationReference:''},{currency:'USD'}]){
  const positions=treasuryPositions({...input,accounts:[...accounts.slice(1),{...accounts[0],...override} as ManagementPaymentAccount]});
  assert.equal(positions.find(p=>p.id==='cash')!.balanceUGX,null);
 }
});
test('Treasury bank overlap and missing child coverage block bank consolidation',()=>{
 const overlapping=treasuryPositions({...input,accounts:[...accounts,account('management_bank',200)]});
 assert.equal(overlapping.find(p=>p.id==='bank')!.balanceUGX,null);
 assert.match(overlapping.find(p=>p.id==='bank')!.reason,/overlap/);
 assert.equal(treasuryPositions({...input,accounts:accounts.filter(a=>a.accountId!==bank.id)}).find(p=>p.id==='bank')!.balanceUGX,null);
});
test('Ledger details retain business date, source branch, reconciliation identity and shift',()=>{
 const a=accounts[0];const eod='eod~tenant_a~b1~2026-11-01~nightShift';
 const entry=mapAuthoritativeMovement(eod+'~cash',{tenantId,accountDocumentId:a.id,amount:100,accountDeltaUGX:100,date:'2026-11-01',branchId:'b1',eodReconciliationId:eod,eodChannel:'cash'},a);
 assert.equal(entry.businessDate,'2026-11-01');assert.equal(entry.shiftId,'nightShift');assert.equal(entry.eodReconciliationId,eod);assert.equal(entry.branchId,'b1');
});
