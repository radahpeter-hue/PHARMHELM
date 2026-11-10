import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recordedAmount,welfareHistoricalBalance} from '../src/domain/finance/welfareHistoricalBalance';

const row=(source:string,status:string,amount:unknown)=>({
 id:source,source,status,amount:recordedAmount(amount),reference:'',date:'',type:''
});

test('recovers historical balance from an allocation and a legacy POS benefit',()=>{
 const records=[row('welfareAllocations','',325000),row('welfare','approved','12,000')];
 assert.equal(welfareHistoricalBalance(records,[]).historicalNet,313000);
 assert.equal(welfareHistoricalBalance(records,[row('petty_cash_ledger','withdrawal',325000)]).historicalNet,313000);
 assert.equal(welfareHistoricalBalance(records,null).historicalNet,null);
});

test('preserves fractional amounts and rejects an unreadable approved benefit',()=>{
 const allocation=row('welfareAllocations','',325000);
 assert.equal(welfareHistoricalBalance([allocation,row('welfare','completed',12000.001)],[]).historicalNet,312999.999);
 assert.equal(welfareHistoricalBalance([allocation,row('welfare','approved','unknown')],[]).historicalNet,null);
});
