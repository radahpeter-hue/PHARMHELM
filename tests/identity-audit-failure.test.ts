import test from 'node:test';
import assert from 'node:assert/strict';
import { identityAuditFailure } from '../src/services/identityAuditFailure.mjs';
test('audit resource failure stays incomplete and exposes no raw error details', () => {
  const report = identityAuditFailure({code:8, details:'Quota exceeded projects/private/staff/secret'}, 'staff');
  assert.equal(report.category,'RESOURCE_EXHAUSTED');
  assert.equal(report.identityDataAssessed,false);
  assert.equal(report.quotaMentioned,true);
  assert.ok(!JSON.stringify(report).includes('secret'));
});
test('audit access failure is distinct from identity discrepancy', () => {
  assert.equal(identityAuditFailure({code:7},'tenants').category,'PERMISSION_DENIED');
  assert.equal(identityAuditFailure({code:14},'tenants').category,'UNAVAILABLE');
});
