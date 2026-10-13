import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planOperationalGrnFinanceEvents } from '../src/services/operationalGrnFinancePolicy';

test('Operational GRN creates consumable OPEX and fixed asset acquisition events separately', () => {
  assert.deepEqual(planOperationalGrnFinanceEvents([
    { operationalType: 'CONSUMABLE_OPERATIONAL', itemId: 'paper', itemName: 'Paper', quantity: 10, totalValueUGX: 400_000 },
    { operationalType: 'CONSUMABLE_OPERATIONAL', itemId: 'soap', itemName: 'Soap', quantity: 3, totalValueUGX: 300_000 },
    { operationalType: 'FIXED_ASSET', itemId: 'laptop', itemName: 'Laptop', quantity: 1, totalValueUGX: 2_000_000 }
  ]).map(({ eventKind, operationalType, amountUGX, lines }) => ({ eventKind, operationalType, amountUGX, count: lines.length })), [
    { eventKind: 'OPERATIONAL_CONSUMABLE_OPEX', operationalType: 'CONSUMABLE_OPERATIONAL', amountUGX: 700_000, count: 2 },
    { eventKind: 'FIXED_ASSET_ACQUISITION', operationalType: 'FIXED_ASSET', amountUGX: 2_000_000, count: 1 }
  ]);
});

test('Operational GRN finance handoff is atomic, deterministic and separate from Sellable procurement finance', () => {
  const service = readFileSync(new URL('../src/services/operationalGrnService.ts', import.meta.url), 'utf8');
  assert.match(service, /operational_finance_events/);
  assert.match(service, /financial_posting_status: 'event_created'/);
  assert.match(service, /planOperationalGrnFinanceEvents\(receivedLines/);
  assert.match(service, /sourceType: 'OPERATIONAL_GRN'/);
  assert.match(service, /return runTransaction\(connection, async transaction/);
  assert.match(service, /financeEventSnapshots\[index\]\.exists\(\)/);
  assert.doesNotMatch(service, /collection\(db, 'finance_ledger'\)/);
  const inventoryUi = readFileSync(new URL('../src/components/inventory/OperationalInventoryTab.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(inventoryUi, /Capital Expenditure:.*Fixed Asset/);
});

test('Operational GRN finance event rules enforce immutable class and subtype-specific event kinds', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const eventRule = rules.slice(rules.indexOf('match /operational_finance_events/'), rules.indexOf('match /grn_records/'));
  assert.match(eventRule, /inventoryClass == 'OPERATIONAL'/);
  assert.match(eventRule, /eventKind == \(request\.resource\.data\.operationalType/);
  assert.match(eventRule, /getAfter\(sourceGrnPath\(\)\)\.data\.inventoryClass == 'OPERATIONAL'/);
  assert.match(eventRule, /allow update, delete: if false/);
});

test('GRN event policy rejects missing subtype and invalid value or quantity', () => {
  assert.throws(() => planOperationalGrnFinanceEvents([]), /must contain lines/);
  assert.throws(() => planOperationalGrnFinanceEvents([{ operationalType: 'SELLABLE', itemId: 'x', itemName: 'x', quantity: 1, totalValueUGX: 1 }] as any), /valid subtype/);
  assert.throws(() => planOperationalGrnFinanceEvents([{ operationalType: 'FIXED_ASSET', itemId: 'x', itemName: 'x', quantity: -1, totalValueUGX: 1 }]), /must be valid/);
});
