import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const salesSource = readFileSync('src/pages/Sales.tsx', 'utf8');

test('receipt ledger imports the dedicated POS V2 revision action', () => {
  assert.match(
    salesSource,
    /import \{ PosV2ReceiptRevisionAction \} from '\.\.\/components\/sales\/PosV2ReceiptRevisionAction';/
  );
});

test('POS V2 table actions use the revision action while legacy edit controls remain separate', () => {
  const tableStart = salesSource.indexOf('selectedSale?.id === sale.id');
  const detailStart = salesSource.indexOf('selectedSale.engineVersion === 2', tableStart);
  assert.ok(tableStart >= 0, 'Receipt Ledger table was not found');
  assert.ok(detailStart > tableStart, 'Receipt details panel was not found after the ledger table');

  const tableSection = salesSource.slice(tableStart, detailStart);
  assert.match(tableSection, /sale\.engineVersion === 2 \? \(/);
  assert.match(tableSection, /<PosV2ReceiptRevisionAction/);
  assert.match(tableSection, /onRevise=\{\(corrected, receiptWindow\) => \{ setSelectedSale\(corrected\); onReviseV2\(corrected, receiptWindow\); \}\}/);
  assert.match(tableSection, /compact/);
  assert.match(tableSection, /onClick=\{\(\) => onEdit\(sale\)\}/);
  assert.match(tableSection, /onClick=\{\(\) => onEditInPOS\(sale\)\}/);
});

test('POS V2 receipt details use the dedicated revision action and preserve print paths', () => {
  const detailStart = salesSource.indexOf('selectedSale.engineVersion === 2');
  assert.ok(detailStart >= 0, 'V2 receipt details action was not found');
  const detailSection = salesSource.slice(detailStart, detailStart + 5000);

  assert.match(detailSection, /<PosV2ReceiptRevisionAction/);
  assert.match(detailSection, /canOperatePos=\{canOperatePos\}/);
  assert.match(detailSection, /Reprint Receipt/);
  assert.match(detailSection, /Print A4 Invoice/);
});

test('legacy mutation paths still fail closed for POS V2 receipts', () => {
  assert.match(
    salesSource,
    /if \(ledgerEditingSale\.engineVersion === 2\)[\s\S]*?POS V2 receipts are immutable and cannot be edited through the legacy ledger path\./
  );
  assert.match(
    salesSource,
    /if \(sale\.engineVersion === 2\)[\s\S]*?POS V2 receipts cannot be edited through the legacy checkout path\./
  );
  assert.match(
    salesSource,
    /if \(sale\.engineVersion === 2\)[\s\S]*?POS V2 receipts require a durable V2 reversal workflow and cannot be voided through the legacy path\./
  );
});

test('receipt revision action is permission-aware and wired only to the dedicated callback', () => {
  assert.match(salesSource, /canOperatePos=\{canProcessSales\}/);
  assert.match(salesSource, /onReviseV2=\{\(sale, receiptWindow\) => \{/);
  assert.doesNotMatch(
    salesSource,
    /onReviseV2=\{(?:onEdit|onEditInPOS)\}/
  );
});
