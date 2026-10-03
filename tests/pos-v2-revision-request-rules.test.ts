import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync('firestore.rules', 'utf8');

function block(startMarker: string, endMarker: string): string {
  const start = rules.indexOf(startMarker);
  const end = rules.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing rules marker: ${startMarker}`);
  assert.ok(end > start, `missing rules boundary after: ${startMarker}`);
  return rules.slice(start, end);
}

test('POS V2 revision requests have a dedicated create-only client boundary', () => {
  const revisionRules = block(
    'match /pos_sale_revision_requests/{requestId}',
    'match /pos_quotations/{quotationId}'
  );

  assert.match(revisionRules, /allow create: if isPOSOperator\(\)/);
  assert.match(revisionRules, /isTenantMember\(request\.resource\.data\.tenantId\)/);
  assert.match(revisionRules, /isAssignedToBranch\(request\.resource\.data\.branchId\)/);
  assert.match(revisionRules, /request\.resource\.data\.requestId == requestId/);
  assert.match(revisionRules, /request\.resource\.data\.requestedBy == request\.auth\.uid/);
  assert.match(revisionRules, /request\.resource\.data\.requestType == 'POS_SALE_REVISION_REQUESTED'/);
  assert.match(revisionRules, /request\.resource\.data\.engineVersion == 2/);
  assert.match(revisionRules, /request\.resource\.data\.payloadVersion == 1/);
  assert.match(revisionRules, /request\.resource\.data\.status == 'PENDING'/);
  assert.match(revisionRules, /allow update, delete: if false/);
});

test('revision request identity and immutable envelope fields are required at creation', () => {
  const revisionRules = block(
    'match /pos_sale_revision_requests/{requestId}',
    'match /pos_quotations/{quotationId}'
  );

  for (const field of [
    'revisionId',
    'originalSaleId',
    'originalReceiptNumber',
    'replacementAttemptId',
    'replacementSaleId',
    'replacementPaymentId',
    'replacementOutboxEventId',
    'reversalEventId',
    'auditId',
    'reason',
    'envelope'
  ]) {
    assert.match(revisionRules, new RegExp(`request\\.resource\\.data\\.${field}`));
  }
});

test('generic tenant fallback cannot grant access to revision requests', () => {
  const genericRules = rules.slice(rules.indexOf('match /{collectionName}/{docId}'));
  const occurrences = genericRules.match(/collectionName != 'pos_sale_revision_requests'/g) ?? [];
  assert.equal(occurrences.length, 5, 'get, list, create, update and delete must all exclude revision requests');
});
