import test from 'node:test';
import assert from 'node:assert/strict';
import {postTrustedFinanceV2Transfer,type TrustedFinanceStore} from '../src/services/financeV2TrustedTransferCore';

const input={tenantId:'t',requestId:'r',sourceAccountId:'bank',destinationAccountId:'cash',chargePayerAccountId:'bank',principalUGX:10000,chargeUGX:300,actorUid:'u'};
const actor={uid:'u',tenantId:'t',active:true,canPostFinance:true};
const original=new Map<string,Record<string,unknown>>([
 ['finance_payment_accounts/t_bank',{tenantId:'t',accountId:'bank',controlVersion:2,currency:'UGX',initialized:true,active:true,balanceUGX:20000,kind:'BANK'}],
 ['finance_payment_accounts/t_cash',{tenantId:'t',accountId:'cash',controlVersion:2,currency:'UGX',initialized:true,active:true,balanceUGX:1000,kind:'BRANCH_CASH_SALES'}]
]);
function fakeStore(){
 const data=new Map([...original].map(([k,v])=>[k,{...v}]));
 const store:TrustedFinanceStore={runTransaction:async fn=>{
  const staged=new Map<string,Record<string,unknown>>();
  const tx={
   get:async(path:string)=>{const found=staged.get(path)??data.get(path);return {exists:!!found,data:()=>found??{}};},
   create:(path:string,value:Record<string,unknown>)=>{if(data.has(path)||staged.has(path))throw Error('already exists');staged.set(path,value);},
   update:(path:string,value:Record<string,unknown>)=>{const before=staged.get(path)??data.get(path);if(!before)throw Error('missing');staged.set(path,{...before,...value});}
  };
  const result=await fn(tx);
  for(const [k,v] of staged)data.set(k,v);
  return result;
 }};
 return {store,data};
}
test('trusted transfer posts full principal, separate fee and rejects replay mutation',async()=>{
 const {store,data}=fakeStore();
 const posted=await postTrustedFinanceV2Transfer(store,actor,input);
 assert.equal(posted.replay,false);
 assert.equal(data.get('finance_payment_accounts/t_bank')?.balanceUGX,9700);
 assert.equal(data.get('finance_payment_accounts/t_cash')?.balanceUGX,11000);
 assert.equal(data.get('finance_v2_events/finance_v2_transfer_t_r_charge')?.amountUGX,300);
 assert.equal(await postTrustedFinanceV2Transfer(store,actor,input).then(x=>x.replay),true);
 await assert.rejects(postTrustedFinanceV2Transfer(store,actor,{...input,principalUGX:9999}),/Conflicting transfer replay/);
});
test('unauthorised and underfunded posting leaves store unchanged',async()=>{
 const {store,data}=fakeStore();
 await assert.rejects(postTrustedFinanceV2Transfer(store,{...actor,canPostFinance:false},input),/Unauthorised/);
 await assert.rejects(postTrustedFinanceV2Transfer(store,actor,{...input,principalUGX:999999}),/Insufficient funds/);
 assert.equal(data.size,2);
});
