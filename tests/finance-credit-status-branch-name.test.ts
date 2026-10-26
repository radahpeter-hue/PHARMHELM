import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceivablesRegister } from '../src/services/creditRecognition';
const record={id:'s',receipt_id:'s',tenantId:'tenant',branch_id:'masaka',paymentId:'p',controlVersion:2,amount_ugx:10000,outstanding_ugx:6000,debtorType:'institution',debtorId:'i'};
const sale={id:'s',tenantId:'tenant',branchId:'masaka',canonicalPaymentId:'p'};
test('credit register derives collections from one verified obligation and resolves branch name',()=>{
 const [r]=buildReceivablesRegister([record],[sale],[],[],[{id:'masaka',name:'Masaka'}]);
 assert.equal(r.collectedUGX,4000);assert.equal(r.branch_name,'Masaka');
});
test('a foreign source or branch mismatch cannot certify a record',()=>{
 for(const source of [{...sale,tenantId:'foreign'},{...sale,branchId:'other'}]) assert.equal(buildReceivablesRegister([record],[source],[],[],[])[0].verified,false);
});
