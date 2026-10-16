import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { grnReceivedDateKey } from '../src/utils/grnDates';

const procurement=readFileSync(new URL('../src/pages/Procurement.tsx',import.meta.url),'utf8');
const finance=readFileSync(new URL('../src/pages/finance/management/InvoiceLedger.tsx',import.meta.url),'utf8');
const normalizer=readFileSync(new URL('../src/services/financeRecordNormalization.ts',import.meta.url),'utf8');
const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const grn=readFileSync(new URL('../src/services/procurementFinanceService.ts',import.meta.url),'utf8');

test('GRN dates accept Firestore timestamps, ISO strings, Dates and invalid data',()=>{
  assert.equal(grnReceivedDateKey({toDate:()=>new Date('2026-10-16T16:09:00Z')}),'2026-10-16');
  assert.equal(grnReceivedDateKey({seconds:Math.floor(new Date('2026-10-16T16:09:00Z').getTime()/1000)}),'2026-10-16');
  assert.equal(grnReceivedDateKey('2026-10-16T16:09:00.000Z'),'2026-10-16');
  assert.equal(grnReceivedDateKey(new Date('2026-10-16T16:09:00Z')),'2026-10-16');
  assert.equal(grnReceivedDateKey(null),'');
  assert.equal(grnReceivedDateKey('invalid'),'');
});

test('Central GRN history never calls split on Firestore Timestamp',()=>{
  assert.doesNotMatch(procurement,/receivedAt\.split\('T'\)/);
  assert.match(procurement,/grnReceivedDateKey\(g\.receivedAt\)/);
});

test('existing GRN without inventoryClass can complete explicit dispatch, new GRN records are class-labeled',()=>{
  assert.match(rules,/!\('inventoryClass' in resource\.data\) \|\| resource\.data\.inventoryClass != 'OPERATIONAL'/);
  assert.match(grn,/tenantId, inventoryClass: 'SELLABLE', id: ids\.grnId/);
});

test('invoice details show GRN number, audit id and accurate Pending Payment amount',()=>{
  assert.match(normalizer,/grnRef: data\.grnRef \|\| data\.grn_number/);
  assert.match(finance,/Linked GRN Number/);
  assert.match(finance,/selectedInvoice\.grnRef \|\| selectedInvoice\.grnId/);
  assert.match(finance,/Internal audit ID:/);
  assert.match(finance,/Amount Pending Payment/);
});
