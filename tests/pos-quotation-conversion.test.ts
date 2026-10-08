import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const v2 = readFileSync(new URL('../src/services/pos-v2/posCheckoutV2Repository.ts', import.meta.url), 'utf8');
const sales = readFileSync(new URL('../src/pages/Sales.tsx', import.meta.url), 'utf8');

test('POS V2 validates and converts the quotation in the same inventory and sale transaction', () => {
  assert.match(v2, /const sourceQuotationRef = request\.sourceQuotationId \? doc\(db, 'pos_quotations'/);
  assert.match(v2, /quotation\.tenantId !== prepared\.authority\.tenantId/);
  assert.match(v2, /quotation\.branchId !== prepared\.authority\.branch\.id/);
  assert.match(v2, /quotation\.status !== 'Draft'/);
  assert.match(v2, /quotationConversionStatus: request\.sourceQuotationId \? 'converted'/);
  assert.match(v2, /transaction\.update\(sourceQuotationRef,[\s\S]{0,260}status: 'Converted'[\s\S]{0,180}convertedReceiptId: prepared\.saleId/);
});

test('legacy checkout also commits quotation conversion atomically and does not schedule a later conversion', () => {
  assert.match(sales, /const quotationRef = resumedQuotationId \? doc\(db, 'pos_quotations'/);
  assert.match(sales, /quotation\.status !== 'Draft'/);
  assert.match(sales, /transaction\.update\(quotationRef,[\s\S]{0,260}status: 'Converted'[\s\S]{0,180}convertedReceiptId: saleDocumentId/);
  assert.doesNotMatch(sales, /convertQuotationToSale\(/);
});
