import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import {
  buildInitialPosV2RevisionDraft,
  PosV2ReceiptRevisionEditor,
  validatePosV2RevisionDraftContext
} from '../src/components/sales/PosV2ReceiptRevisionEditor';
import {
  clientRevisionOption,
  institutionRevisionOption,
  prescriberRevisionOption,
  revisionInstitutionSelection,
  revisionPatientSelection,
  revisionPrescriberSelection
} from '../src/services/pos-v2/posSaleRevisionV2ReferenceData';
import { buildPosV2RevisionPlan } from '../src/services/pos-v2/posSaleRevisionV2Planner';
import { buildPosV2RevisionSubmissionRequest } from '../src/services/pos-v2/posSaleRevisionV2Submission';
import { assertPosV2RevisionFirestoreSafe } from '../src/services/pos-v2/posSaleRevisionV2FirestoreSafety';
import { buildPosV2ReplacementSnapshots } from '../src/services/pos-v2/posSaleRevisionV2ReplacementExecution';
import { buildPosV2ReplacementCheckoutRequest } from '../src/services/pos-v2/posSaleRevisionV2ReplacementOrchestrator';
import { normalizePosPaymentMethod } from '../src/utils/posPaymentMethods';

const now = new Date('2026-10-02T08:00:00.000Z');

function original(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sale-v2-vit-c', tenantId: 'tenant-a', branchId: 'branch-a', receiptNumber: 'MSK-2026-0009',
    timestamp: '2026-10-01T08:00:00.000Z', engineVersion: 2, status: 'completed', cashierId: 'cashier-a',
    paymentMethod: 'Cash', context: 'walk-in', patientId: null, patientName: null, institutionId: null,
    institutionName: null, prescriberId: null, prescriberName: null, discountPercentage: 0,
    subtotal: 2500, tax: 0, total: 2500, totalAmount: 2500,
    items: [{
      productId: 'vit-c', productName: 'Vitamin C', name: 'Vitamin C', batchId: 'batch-a', quantity: 5,
      unitPrice: 500, actualUnitPrice: 500, total: 2500, optionalHistoricalField: undefined
    }],
    ...overrides
  } as any;
}

test('payment aliases normalize to canonical choices and unsupported values fail closed', () => {
  assert.equal(normalizePosPaymentMethod('Cash'), 'cash');
  assert.equal(normalizePosPaymentMethod('momo'), 'mtn_momo');
  assert.equal(normalizePosPaymentMethod('AIRTEL'), 'airtel_money');
  assert.equal(normalizePosPaymentMethod('credit'), 'institutional_credit');
  assert.equal(normalizePosPaymentMethod('mobile_money'), null);
});

test('mixed registry schemas become human-readable canonical options and preserve document IDs', () => {
  const client = clientRevisionOption({ id: 'client-9', full_name: 'Amina Noor', phone_number: '0700000000', care_status: 'active' });
  const institution = institutionRevisionOption({ id: 'inst-4', supplier_name: 'Kampala Clinic', commercial_category: 'Clinic', status: 'active', credit_eligible: true });
  const prescriber = prescriberRevisionOption({ id: 'rx-3', name: 'Dr Kato', professional_licence_number: 'UMD-44', specialty: 'Paediatrics' });
  assert.deepEqual(revisionPatientSelection(client), { patientId: 'client-9', patientName: 'Amina Noor', patientIsStaff: false });
  assert.deepEqual(revisionInstitutionSelection(institution), { institutionId: 'inst-4', institutionName: 'Kampala Clinic', institutionBillingEligible: true });
  assert.deepEqual(revisionPrescriberSelection(prescriber), { prescriberId: 'rx-3', prescriberName: 'Dr Kato' });
  assert.match(client.secondary, /0700000000/);
  assert.match(prescriber.secondary, /UMD-44/);
  assert.equal(clientRevisionOption({ id: 'blocked', name: 'Blocked', status: 'blacklisted' }).selectable, false);
});

test('revision editor renders controlled selectors instead of editable identity or payment text fields', () => {
  const sale = original();
  const html = renderToStaticMarkup(React.createElement(PosV2ReceiptRevisionEditor, {
    sale, onCancel: () => {}, onContinue: () => {}, referencesReady: true,
    referenceClients: [clientRevisionOption({ id: 'client-1', name: 'Client One' })],
    referenceInstitutions: [institutionRevisionOption({ id: 'inst-1', name: 'Institution One' })],
    referencePrescribers: [prescriberRevisionOption({ id: 'rx-1', name: 'Dr One' })]
  }));
  assert.match(html, /<select[^>]*><option value="cash" selected=""/);
  assert.match(html, /Client \/ patient/);
  assert.match(html, /grid-cols-1 sm:grid-cols-2/);
  assert.match(html, /min-h-\[44px\]/);
  assert.doesNotMatch(html, /<input[^>]+value="client-1"/);
  const editorSource = readFileSync('src/components/sales/PosV2ReceiptRevisionEditor.tsx', 'utf8');
  assert.doesNotMatch(editorSource, /onChange=\{event => setDraft\(current => \(\{ \.\.\.current, patientId:/);
  assert.doesNotMatch(editorSource, /onChange=\{event => setDraft\(current => \(\{ \.\.\.current, paymentMethod: event\.target\.value \}\)\)\} className=.*<input/);
});

test('registry subscriptions are activated with the authenticated tenant only', () => {
  const action = readFileSync('src/components/sales/PosV2ReceiptRevisionAction.tsx', 'utf8');
  const bridge = readFileSync('src/components/sales/usePosV2RevisionCatalogData.ts', 'utf8');
  const firestore = readFileSync('src/services/firestore.ts', 'utf8');
  assert.match(action, /authenticatedTenantId === saleTenantId \? authenticatedTenantId : null/);
  assert.match(bridge, /'clients', tenantId/);
  assert.match(bridge, /'institutions', tenantId/);
  assert.match(bridge, /'prescribers', tenantId/);
  assert.match(firestore, /where\('tenantId', '==', tenantId\)/);
});

test('context rules block missing or incompatible identities before review', () => {
  const sale = original();
  const draft = buildInitialPosV2RevisionDraft(sale);
  assert.equal(validatePosV2RevisionDraftContext(draft, sale), null);
  assert.match(validatePosV2RevisionDraftContext({ ...draft, context: 'telepharmacy' }, sale) || '', /required/i);
  assert.match(validatePosV2RevisionDraftContext({ ...draft, context: 'institutional' }, sale) || '', /institution/i);
  assert.match(validatePosV2RevisionDraftContext({ ...draft, paymentMethod: 'institutional_credit', patientId: 'client-1', patientName: 'Client' }, sale) || '', /eligible institution/i);
  assert.match(validatePosV2RevisionDraftContext({ ...draft, context: 'walk-in', institutionId: 'historical-inst', institutionName: 'Historical' }, sale) || '', /remove the institution/i);
});

test('unchanged unavailable historical identity remains in the initial draft', () => {
  const sale = original({ patientId: 'missing-client', patientName: 'Historical Client' });
  const draft = buildInitialPosV2RevisionDraft(sale);
  assert.equal(draft.patientId, 'missing-client');
  assert.equal(draft.patientName, 'Historical Client');
});

test('Vitamin C base-unit quantity correction produces a fully Firestore-safe immutable request', () => {
  const sale = original();
  const revisedItems = [{ ...sale.items[0], quantity: 50, total: 25000, anotherOptional: undefined }];
  const plan = buildPosV2RevisionPlan({
    originalSale: sale, revisedItems, revisedTotal: 25000, reason: 'Correct Vitamin C quantity from five to fifty units', now
  });
  assert.equal('tierCode' in plan.itemChanges[0], false);
  const request = buildPosV2RevisionSubmissionRequest({
    originalSale: sale, plan, revisedItems, actor: { uid: 'manager-1', name: 'Branch Manager' }
  });
  assert.doesNotThrow(() => assertPosV2RevisionFirestoreSafe(request));
  assert.equal(JSON.stringify(request).includes('undefined'), false);
  assert.equal('optionalHistoricalField' in request.revisedItems[0], false);
  assert.equal('anotherOptional' in request.envelope.replacementSaleSeed.items[0], false);
  assert.equal(request.revisedTotal, 25000);
});

test('changed canonical identities propagate IDs, names and customer compatibility into replacement checkout', () => {
  const sale = original();
  const plan = buildPosV2RevisionPlan({
    originalSale: sale,
    revisedItems: sale.items,
    revisedTotal: 2500,
    context: 'institutional',
    patientId: 'client-new', patientName: 'New Client',
    institutionId: 'inst-new', institutionName: 'New Institution', institutionBillingEligible: true,
    prescriberId: 'rx-new', prescriberName: 'Dr New',
    reason: 'Correct all linked receipt identities', now
  });
  const request = buildPosV2RevisionSubmissionRequest({
    originalSale: sale, plan, revisedItems: sale.items, actor: { uid: 'manager-1', name: 'Branch Manager' }
  });
  const snapshots = buildPosV2ReplacementSnapshots(sale, request.envelope);
  const checkout = buildPosV2ReplacementCheckoutRequest({ revisionRequestId: request.requestId, envelope: request.envelope, snapshots });
  assert.equal(checkout.customerId, 'client-new');
  assert.equal(checkout.patientId, 'client-new');
  assert.equal(checkout.patientName, 'New Client');
  assert.equal(checkout.institutionId, 'inst-new');
  assert.equal(checkout.institutionName, 'New Institution');
  assert.equal(checkout.prescriberId, 'rx-new');
  assert.equal(checkout.prescriberName, 'Dr New');
});

test('recursive Firestore assertion reports the exact unsafe array path', () => {
  assert.throws(
    () => assertPosV2RevisionFirestoreSafe({ envelope: { replacementSaleSeed: { items: [{ batchAllocations: [undefined] }] } } }),
    /request\.envelope\.replacementSaleSeed\.items\[0\]\.batchAllocations\[0\]/
  );
});
