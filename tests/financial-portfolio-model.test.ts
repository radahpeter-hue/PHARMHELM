import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defineFinancialPortfolio, portfolioMatchesScope, validateFinancialPortfolio,
  type NewFinancialPortfolio
} from '../src/domain/finance/financialPortfolio';

const base: NewFinancialPortfolio = {
  id:'bank_portfolio', tenantId:'mp', name:' Bank ', classification:'bank',
  description:'Cash at financial institutions',scope:{kind:'organisation'},
  currency:'UGX',origin:'system',supportsChildAccounts:true,
  allowsTransfersIn:true,allowsTransfersOut:true,createdBy:'ceo_1',
  createdAt:'2026-10-29T09:00:00.000Z'
};
test('Change 032 creates validated generic portfolios without moving money',()=>{
  const result=defineFinancialPortfolio(base);
  assert.equal(result.name,'Bank');
  assert.equal(result.status,'active');
  assert.equal(result.updatedBy,'ceo_1');
  assert.equal('balanceUGX' in result,false);
  assert.equal(portfolioMatchesScope(result,'mp'),true);
  assert.equal(portfolioMatchesScope(result,'foreign'),false);
});
test('Change 032 keeps branch-specific scope distinct from organisation',()=>{
  const branch=defineFinancialPortfolio({...base,id:'masaka_cash',scope:{kind:'branch',branchId:'masaka'},classification:'cash_equivalent'});
  assert.equal(portfolioMatchesScope(branch,'mp','masaka'),true);
  assert.equal(portfolioMatchesScope(branch,'mp','kampala'),false);
  assert.equal(portfolioMatchesScope(branch,'other','masaka'),false);
});
test('Change 032 rejects arbitrary classifications, bad scope and flags',()=>{
  assert.throws(()=>defineFinancialPortfolio({...base,classification:'revenue' as any}),/classification/);
  assert.throws(()=>defineFinancialPortfolio({...base,scope:{kind:'branch',branchId:''}}),/branch ID/);
  assert.throws(()=>defineFinancialPortfolio({...base,scope:{kind:'organisation',branchId:'masaka'} as any}),/cannot have/);
  assert.throws(()=>defineFinancialPortfolio({...base,allowsTransfersOut:'yes' as any}),/capability/);
});
test('Change 032 requires identity, audit timestamps and deactivation metadata',()=>{
  assert.throws(()=>defineFinancialPortfolio({...base,tenantId:''}),/identifiers/);
  assert.throws(()=>defineFinancialPortfolio({...base,createdAt:'not-a-date'}),/timestamps/);
  const active=defineFinancialPortfolio(base);
  assert.throws(()=>validateFinancialPortfolio({...active,status:'inactive'}),/deactivation/);
  const inactive=validateFinancialPortfolio({...active,status:'inactive',deactivatedBy:'ceo_1',deactivatedAt:'2026-10-29T10:00:00.000Z'});
  assert.equal(inactive.status,'inactive');
  assert.throws(()=>validateFinancialPortfolio({...active,deactivatedBy:'ceo_1'}),/Active portfolio/);
});

test('Change 032 refuses missing actor and branch identifiers',()=>{
  assert.throws(()=>defineFinancialPortfolio({...base,createdBy:undefined as any}),/identifiers/);
  assert.throws(()=>defineFinancialPortfolio({...base,scope:{kind:'branch',branchId:undefined as any}}),/branch ID/);
});
