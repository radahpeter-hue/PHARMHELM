import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRevisionDraftCommercialFields, assertRevisionCommercialEvidence, revisionCommercialEvidenceIssues } from '../scripts/pos-v2-revision-commercial-evidence.mjs';
const item = { productId: 'vitc', quantity: 30, commercialQuantity: 30, unitPrice: 500, actualUnitPrice: 500 };
const request = { revisedTotal: 15000, revisedItems: [item] };
const sale = { totalAmount: 15000, items: [{ ...item, batchId: 'new-fefo-batch' }] };
test('the exact old visible 30 hidden 10 draft is rejected before checkout', () => {
  assert.throws(() => assertRevisionDraftCommercialFields([{ ...item, commercialQuantity: 10 }]), /checkout quantity/);
  assert.throws(() => assertRevisionDraftCommercialFields([{ ...item, actualUnitPrice: 100 }]), /checkout price/);
});
test('commercial evidence accepts canonical FEFO and preserves recovered historical request evidence', () => {
  assert.doesNotThrow(() => assertRevisionCommercialEvidence({ request, replacementSale: sale, payment: { amount: 15000 } }));
  assert.doesNotThrow(() => assertRevisionCommercialEvidence({ request: { ...request, revisedItems: [{ ...item, commercialQuantity: 10 }] }, replacementSale: sale, payment: { amount: 15000 } }));
});
test('quantity price payment total and line identity mismatches cannot appear complete', () => {
  for (const replacementSale of [{ ...sale, totalAmount: 5000 }, { ...sale, items: [{ ...item, commercialQuantity: 10 }] },
    { ...sale, items: [{ ...item, actualUnitPrice: 100 }] }, { ...sale, items: [{ ...item, productId: 'other' }] }]) {
    assert.throws(() => assertRevisionCommercialEvidence({ request, replacementSale, payment: { amount: 15000 } }), /commercial evidence mismatch/);
  }
  assert.throws(() => assertRevisionCommercialEvidence({ request, replacementSale: sale, payment: { amount: 5000 } }), /payment amount/);
});
test('older change-only evidence catches quantity drift even when receipt total matches', () => {
  const issues = revisionCommercialEvidenceIssues({ request: { revisedTotal: 15000, itemChanges: [{ productId: 'vitc', afterQuantity: 30, afterUnitPrice: 500 }] },
    replacementSale: { ...sale, items: [{ ...item, commercialQuantity: 10 }] } });
  assert.ok(issues.some(issue => issue.includes('items differ')));
});
