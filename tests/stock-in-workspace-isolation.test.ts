import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/StockInOut.tsx', import.meta.url), 'utf8');

test('Stock In exposes two separate responsive Sellable and Operational workspaces', () => {
  const section = source.slice(source.indexOf('const StockInWorkspace:'), source.indexOf('const StockInTab:'));
  assert.match(section, /inventoryView.*'sellable'.*'operational'/);
  assert.match(section, /Stock In inventory type/);
  assert.match(section, /aria-pressed=\{inventoryView === 'sellable'\}/);
  assert.match(section, /aria-pressed=\{inventoryView === 'operational'\}/);
  assert.match(section, /<OperationalBranchReceiptQueue \/>/);
  assert.match(section, /<StockInTab branches=\{branches\} \/>/);
  assert.match(section, /grid-cols-1 sm:grid-cols-2/);
});

test('Sellable Stock In refuses explicitly Operational transfers and unshipped transfers', () => {
  assert.match(source, /export function isSellableStockInInvoice/);
  assert.match(source, /invoice\.inventoryClass !== 'OPERATIONAL'/);
  assert.match(source, /invoice\.status !== 'ready_for_dispatch'/);
  assert.match(source, /filtered\.filter\(isSellableStockInInvoice\)/);
  assert.match(source, /sellableInvoices\.filter\(i => \['dispatched', 'receiving'\]/);
  assert.match(source, /Operational stock must be received in Operational Stock In/);
});

test('Sellable reception blocks wrong tenant, branch, class and mismatched quantities', () => {
  assert.match(source, /current\.data\(\)\.tenantId !== profile\.tenantId/);
  assert.match(source, /current\.data\(\)\.destination_branch_id !== activeBranchId/);
  assert.match(source, /current\.data\(\)\.inventoryClass === 'OPERATIONAL'/);
  assert.match(source, /invoiceLines\.some\(line => line\.inventoryClass === 'OPERATIONAL'\)/);
  assert.match(source, /values\.accepted \+ values\.queried !== line\.qty_dispatched/);
});

test('Operational Stock In uses operational transfer ledger rather than Sellable invoice lines', () => {
  const operational = source.slice(source.indexOf('const OperationalBranchReceiptQueue:'), source.indexOf('const OperationalBranchReceiptQueue:') + 13000);
  assert.match(operational, /'operational_transfers'/);
  assert.match(operational, /'operational_transfer_lines'/);
  assert.match(operational, /receiveOperationalTransferLine\(/);
  assert.doesNotMatch(operational, /'transfer_invoice_lines'/);
});
