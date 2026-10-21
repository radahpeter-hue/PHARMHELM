import { operationalReceiptCostPerPack } from '../src/services/operationalValuationPolicy';
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

test('Operational GRN refuses fractional UGX, fractional quantity and unsafe totals before writing events', () => {
  const valid = { operationalType: 'CONSUMABLE_OPERATIONAL' as const, itemId: 'paper', itemName: 'Paper', quantity: 1, totalValueUGX: 1 };
  assert.throws(() => planOperationalGrnFinanceEvents([{ ...valid, quantity: 1.5 }]), /whole numbers/);
  assert.throws(() => planOperationalGrnFinanceEvents([{ ...valid, totalValueUGX: 1.5 }]), /whole numbers/);
  assert.throws(() => planOperationalGrnFinanceEvents([{ ...valid, totalValueUGX: Number.MAX_SAFE_INTEGER + 1 }]), /whole numbers/);
  assert.throws(() => planOperationalGrnFinanceEvents([
    { ...valid, itemId: 'a', totalValueUGX: Number.MAX_SAFE_INTEGER },
    { ...valid, itemId: 'b', totalValueUGX: 1 }
  ]), /exceeds safe whole-number/);
});

test('Operational GRN validates received amounts before opening a transaction', () => {
  const service = readFileSync(new URL('../src/services/operationalGrnService.ts', import.meta.url), 'utf8');
  assert.match(service, /Number\.isSafeInteger\(quantity\)/);
  assert.match(service, /Number\.isSafeInteger\(cost\)/);
  assert.match(service, /Number\.isSafeInteger\(quantity \* cost\)/);
  assert.match(service, /quantity > 0 && cost === 0/);
  assert.ok(service.indexOf('Number.isSafeInteger(quantity)') < service.indexOf('return runTransaction(connection'));
});

test('Operational receipt cost preserves pack semantics and weighted value for later transfers', () => {
  assert.equal(operationalReceiptCostPerPack(0, 24, 0, 100, 12), 1200);
  assert.equal(operationalReceiptCostPerPack(12, 12, 1200, 200, 12), 1800);
  assert.throws(() => operationalReceiptCostPerPack(-1, 12, 1200, 100, 12));
});
