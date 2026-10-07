import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/services/pos-v2/posSaleRevisionV2SubmissionRepository.ts', 'utf8');

test('revision submission repository rechecks live POS authority and 72-hour eligibility before persistence', () => {
  assert.match(source, /auth\.currentUser/);
  assert.match(source, /currentUser\.uid/);
  assert.match(source, /loadCheckoutV2Authority\(currentUser\.uid, originalBranchId\)/);
  assert.match(source, /authority\.tenantId/);
  assert.match(source, /originalTenantId/);
  assert.match(source, /evaluatePosV2RevisionEligibility/);
  assert.match(source, /REVISION_WINDOW_EXPIRED/);
});

test('revision submission uses deterministic document identity and an idempotent transaction', () => {
  assert.match(source, /posV2RevisionRequestDocumentId\(request\)/);
  assert.match(source, /runTransaction\(db/);
  assert.match(source, /transaction\.get\(requestRef\)/);
  assert.match(source, /existingSnapshot\.exists\(\)/);
  assert.match(source, /isSamePosV2RevisionSubmission/);
  assert.match(source, /transaction\.set\(requestRef, request\)/);
});

test('revision submission repository does not mutate original sale, inventory, payment or finance records', () => {
  assert.doesNotMatch(source, /transaction\.update\(/);
  assert.doesNotMatch(source, /transaction\.delete\(/);
  assert.doesNotMatch(source, /collection\(db, ['"]sales['"]/);
  assert.doesNotMatch(source, /product_batches/);
  assert.doesNotMatch(source, /pos_payments/);
  assert.doesNotMatch(source, /finance_ledger/);
});

test('revision progress monitoring is read-only and watches only the durable request document', () => {
  assert.match(source, /onSnapshot\(/);
  assert.match(source, /pos_sale_revision_requests/);
  assert.match(source, /watchPosV2RevisionRequest/);
});
