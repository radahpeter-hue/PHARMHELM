import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repository = readFileSync('src/services/pos-v2/posCheckoutV2Repository.ts', 'utf8');

test('transaction revalidates effective sales permission from the live staff roles', () => {
  assert.match(repository, /resolveSalesAccessInTransaction/);
  assert.match(repository, /transaction\.get\(doc\(db, 'staff', prepared\.authority\.uid\)\)/);
  assert.match(repository, /const liveSalesAccess = await resolveSalesAccessInTransaction/);
  assert.match(repository, /operator no longer has effective sales:operate permission/i);
});

test('human receipt number keeps the established branch-year-six-digit shape', () => {
  assert.match(repository, /function deterministicReceiptSuffix/);
  assert.match(repository, /100000 \+ \(checksum % 900000\)/);
  assert.match(repository, /receiptNumber = `\$\{branchCode\}-\$\{new Date\(\)\.getFullYear\(\)\}-\$\{deterministicReceiptSuffix\(prepared\.saleId\)\}`/);
  assert.doesNotMatch(repository, /saleId\.slice\(-8\)/);
});

test('technical sale identity remains deterministic and separate from human receipt numbering', () => {
  assert.match(repository, /checkoutV2SaleDocumentId\(tenantId: string, attemptId: string\)/);
  assert.match(repository, /deterministicDocumentId\('v2sale', tenantId, attemptId\)/);
  assert.match(repository, /saleRef: doc\(db, 'sales', saleId\)/);
});
