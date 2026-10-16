import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync('firestore.rules', 'utf8');
const stockPage = readFileSync('src/pages/StockInOut.tsx', 'utf8');

const ruleBlock = (collection: string, next: string) => {
  const start = rules.indexOf(`match /${collection}/`);
  const end = next ? rules.indexOf(`match /${next}/`, start + 1) : rules.indexOf('\n    match /', start + 1);
  assert.ok(start >= 0 && end > start, `Rules for ${collection} not found`);
  return rules.slice(start, end);
};

test('procurement GRN transfer authorization requires a posted matching GRN', () => {
  const block = ruleBlock('transfer_invoices', 'transfer_invoice_lines');
  assert.match(block, /isStockOperator\(\) \|\| \(/);
  assert.match(block, /isProcurement\(\)/);
  assert.match(block, /request\.resource\.data\.get\('inventoryClass', ''\) == 'SELLABLE'/);
  assert.match(block, /getAfter\(\/databases\/\$\(database\)\/documents\/grn_records\/\$\(request\.resource\.data\.grn_id\)\)\.data\.transfer_id == invoiceId/);
  assert.match(block, /financial_posting_status in \['posted', 'not_applicable'\]/);
});

test('procurement GRN line authorization requires the same transfer ID and tenant', () => {
  const block = ruleBlock('transfer_invoice_lines', '');
  assert.match(block, /isStockOperator\(\) \|\| \(/);
  assert.match(block, /isProcurement\(\)/);
  assert.match(block, /getAfter\(\/databases\/\$\(database\)\/documents\/grn_records\/\$\(request\.resource\.data\.grn_id\)\)\.data\.transfer_id == request\.resource\.data\.transfer_id/);
});

test('Stock In has separate feature-gated sellable and operational workspaces', () => {
  const workspace = stockPage.slice(stockPage.indexOf('const StockInWorkspace:'), stockPage.indexOf('const StockInTab:'));
  assert.match(workspace, /useOperationalInventoryFeature\(\)/);
  assert.match(workspace, /Sellable Inventory/);
  assert.match(workspace, /Operational Inventory/);
  assert.match(workspace, /operationalEnabled && inventoryView === 'operational'/);
  assert.match(workspace, /OperationalBranchReceiptQueue/);
  assert.match(workspace, /<StockInTab branches=\{branches\}/);
});
