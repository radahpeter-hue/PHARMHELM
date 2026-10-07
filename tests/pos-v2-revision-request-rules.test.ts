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

const revisionRules = block(
  'match /pos_sale_revision_requests/{requestId}',
  'match /welfare_records/{recordId}'
);

const protectedHelper = block(
  'function isProtectedFinanceCollection(collectionName)',
  'function canViewProcurement()'
);

test('POS V2 revision requests have a dedicated create-only client boundary', () => {
  assert.match(revisionRules, /allow create: if isPOSOperator\(\)/);
  assert.match(revisionRules, /isTenantMember\(request\.resource\.data\.tenantId\)/);
  assert.match(revisionRules, /isAssignedToBranch\(request\.resource\.data\.branchId\)/);
  assert.match(revisionRules, /hasValidRevisionRequestEnvelope\(\)/);
  assert.match(revisionRules, /allow update, delete: if false/);
});

test('POS operator authority requires a current active authoritative staff record', () => {
  assert.match(rules, /function hasActiveStaffProfile\(\)/);
  assert.match(rules, /exists\(\/databases\/\$\(database\)\/documents\/staff\/\$\(request\.auth\.uid\)\)/);
  assert.match(rules, /'active' in get\([\s\S]*data\.active == true/);
  assert.match(rules, /'status' in get\([\s\S]*data\.status in \['active', 'Active', 'ACTIVE'\]/);

  const posOperatorStart = rules.indexOf('function isPOSOperator()');
  const posOperatorEnd = rules.indexOf('function isMarketing()', posOperatorStart);
  const posOperator = rules.slice(posOperatorStart, posOperatorEnd);
  assert.match(posOperator, /hasActiveStaffProfile\(\)/);
});

test('revision request creation is pinned to canonical pending identity and authenticated actor', () => {
  assert.match(revisionRules, /revision\.requestId == requestId/);
  assert.match(revisionRules, /revision\.requestedBy == request\.auth\.uid/);
  assert.match(revisionRules, /revision\.requestType == 'POS_SALE_REVISION_REQUESTED'/);
  assert.match(revisionRules, /revision\.engineVersion == 2/);
  assert.match(revisionRules, /revision\.payloadVersion == 1/);
  assert.match(revisionRules, /revision\.status == 'PENDING'/);
  assert.match(revisionRules, /revision\.reason\.size\(\) >= 8/);
  assert.match(revisionRules, /revision\.reason\.size\(\) <= 500/);
  assert.match(revisionRules, /revision\.pendingReplacementSaleId == revision\.replacementSaleId/);
});

test('revision request identity and immutable envelope fields are allowlisted at creation', () => {
  assert.match(revisionRules, /revision\.keys\(\)\.hasOnly\(\[/);

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
    assert.match(revisionRules, new RegExp(`'${field}'`));
  }
});

test('generic tenant fallback cannot reopen revision request reads, writes or deletion', () => {
  assert.match(protectedHelper, /'pos_sale_revision_requests'/);

  const genericRules = rules.slice(rules.indexOf('match /{collectionName}/{docId}'));
  const genericAllows = genericRules
    .split('\n')
    .filter((line) => /allow (get|list|create|update|delete):/.test(line));

  assert.equal(genericAllows.length, 5, 'expected generic get, list, create, update and delete rules');
  for (const line of genericAllows) {
    assert.match(
      line,
      /!isProtectedFinanceCollection\(collectionName\)/,
      `protected revision collection escaped generic boundary: ${line.trim()}`
    );
  }

  assert.match(revisionRules, /allow update, delete: if false/);
});

test('revision ledger reads enforce assigned-branch or explicit tenant-wide management authority', () => {
  assert.match(rules, /function canViewGlobalRevisionLedger\(\)/);
  assert.match(rules, /function canViewBranchRevisionLedger\(branchId\)/);
  assert.match(rules, /isAssignedToBranch\(branchId\)/);
  assert.match(rules, /hasAnyRole\(\['QA Head', 'QA Manager'\]\)/);
  assert.match(revisionRules, /canViewGlobalRevisionLedger\(\)/);
  assert.match(revisionRules, /canViewBranchRevisionLedger\(resource\.data\.branchId\)/);
  assert.doesNotMatch(
    revisionRules,
    /allow list: if isAuthenticated\(\) && isTenantMember\(resource\.data\.tenantId\);/
  );
});

test('opening stock batch guard still indexes the accepted line by openingStockLineIndex', () => {
  assert.match(
    rules,
    /data\.lines\[request\.resource\.data\.openingStockLineIndex\]\.quantity/
  );
  assert.doesNotMatch(
    rules,
    /data\.lines\[request\.resource\.data\.openingStockSessionId\]\.quantity/
  );
});
