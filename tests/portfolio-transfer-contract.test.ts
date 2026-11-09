import test from 'node:test';
import assert from 'node:assert/strict';
import {definePortfolioTransfer,portfolioTransferIdentity,type TransferEndpoint} from '../src/domain/finance/portfolioTransfer';
const endpoint=(accountId:string,portfolioId='system_bank'):TransferEndpoint=>({tenantId:'mp',portfolioId,accountId,
  accountDocumentId:'mp_'+accountId,name:accountId,branchId:'',kind:'bank'});
const input={id:'pt_'+'a'.repeat(64),tenantId:'mp',source:endpoint('equity'),destination:endpoint('stanbic'),
  principalUGX:2000000,chargeUGX:5000,reference:' trf-001 ',initiatedBy:'finance',initiatedAt:'2026-11-06T08:00:00Z'};
test('059: bank principal and charge have distinct, deterministic linked movements',()=>{
  const record=definePortfolioTransfer(input);
  assert.equal(record.transferClass,'intra_portfolio');assert.equal(record.reference,'TRF-001');
  assert.equal(record.sourceMovement.id,record.id+'_out');assert.equal(record.destinationMovement.id,record.id+'_in');
  assert.equal(record.chargeMovement?.id,record.id+'_fee');assert.equal(record.principalUGX,2000000);
  assert.equal(record.reversalOf,null);assert.equal(record.status,'completed');
  const noCharge=definePortfolioTransfer({...input,chargeUGX:0});assert.equal(noCharge.chargeMovement,null);
  const cash=definePortfolioTransfer({...input,source:{...endpoint('bcs','system_branch_cash_sales_masaka'),kind:'petty_cash',branchId:'masaka'}});
  assert.equal(cash.transferClass,'inter_portfolio');assert.equal(cash.sourceMovement.collection,'petty_cash_ledger');
});
test('059: rejects malformed money, overflow and incomplete traceability',()=>{
  for(const principalUGX of [0,-1,0.1,NaN,Infinity,'100' as any])assert.throws(()=>definePortfolioTransfer({...input,principalUGX}),/whole UGX/);
  for(const chargeUGX of [-1,0.1,NaN,Infinity,'0' as any])assert.throws(()=>definePortfolioTransfer({...input,chargeUGX}),/whole UGX/);
  assert.throws(()=>definePortfolioTransfer({...input,principalUGX:Number.MAX_SAFE_INTEGER,chargeUGX:1}),/whole UGX/);
  assert.throws(()=>definePortfolioTransfer({...input,initiatedAt:'invalid'}),/timestamp/);
  assert.throws(()=>definePortfolioTransfer({...input,initiatedBy:undefined as any}),/identities/);
  assert.throws(()=>definePortfolioTransfer({...input,destination:input.source}),/different/);
  assert.throws(()=>definePortfolioTransfer({...input,destination:{...input.destination,tenantId:'foreign'}}),/tenant mismatch/);
  assert.throws(()=>definePortfolioTransfer({...input,source:{...input.source,accountDocumentId:'foreign_equity'}}),/identity/);
});
test('059: same tenant/reference keeps its identity across sessions; payload changes cannot create a new intent',async()=>{
  const id=await portfolioTransferIdentity('mp','TRF-001');
  assert.equal(id,await portfolioTransferIdentity('mp',' trf-001 '));
  assert.notEqual(id,await portfolioTransferIdentity('other','TRF-001'));
  assert.notEqual(id,await portfolioTransferIdentity('mp','TRF-002'));
  await assert.rejects(portfolioTransferIdentity('mp','abc'),/reference/);
});
