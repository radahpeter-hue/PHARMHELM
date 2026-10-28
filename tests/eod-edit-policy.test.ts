import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCorrectEod, eodEditDeadline } from '../src/utils/eodEditPolicy';
const rec={tenantId:'mp',reconciliation_date:'2026-10-01'};
const it={tenantId:'mp',role:'IT Head'};
test('cutoff uses Kampala midnight and locks at precisely 14 days',()=>{
 const cutoff=Date.parse('2026-10-15T00:00:00+03:00');
 assert.equal(eodEditDeadline(rec.reconciliation_date),cutoff);
 assert.equal(canCorrectEod(it,rec,cutoff-1),true);
 assert.equal(canCorrectEod(it,rec,cutoff),false);
 assert.equal(canCorrectEod(it,rec,cutoff+1),false);
});
test('submitted reconciliations exclude owner, support, cashier, foreign tenant and future dates',()=>{
 const now=Date.parse('2026-10-02T00:00:00+03:00');
 for(const role of ['owner','CEO','IT Support Staff','Finance Head','cashier']) assert.equal(canCorrectEod({...it,role},rec,now),false);
 assert.equal(canCorrectEod({...it,tenantId:'other'},rec,now),false);
 assert.equal(canCorrectEod(it,rec,Date.parse('2026-09-30T00:00:00+03:00')),false);
 assert.equal(canCorrectEod({...it,role:'cashier',secondaryRoles:['IT Head']},rec,now),true);
});
test('invalid dates fail closed',()=>{
 for(const date of ['2026-02-30','invalid','','2026-2-1']) assert.ok(Number.isNaN(eodEditDeadline(date)));
});
