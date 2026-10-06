import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/sales/PosV2ReceiptRevisionCatalogPicker.tsx', 'utf8');

test('revision catalog picker delegates line creation to certified adapter', () => {
  assert.match(source, /buildPosV2RevisionCatalogLine/);
  assert.match(source, /getPosV2RevisionCatalogOptions/);
  assert.match(source, /tenantId/);
  assert.match(source, /branchId/);
  assert.match(source, /existingItems/);
});

test('revision catalog picker exposes live selling tier choices instead of inventing packaging', () => {
  assert.match(source, /options\.map\(option/);
  assert.match(source, /option\.code/);
  assert.match(source, /option\.multiplier/);
  assert.match(source, /option\.configuredPrice/);
  assert.doesNotMatch(source, /unitsPerStrip\s*\|\|/);
  assert.doesNotMatch(source, /unitsPerPack\s*\|\|/);
});

test('revision catalog picker remains local-only', () => {
  assert.doesNotMatch(source, /firebase\/firestore/);
  assert.doesNotMatch(source, /firestoreService/);
  assert.doesNotMatch(source, /executeCheckoutV2/);
  assert.doesNotMatch(source, /pos_sale_revision_requests/);
  assert.doesNotMatch(source, /addDoc\s*\(/);
  assert.doesNotMatch(source, /setDoc\s*\(/);
  assert.doesNotMatch(source, /updateDoc\s*\(/);
});

test('revision catalog picker explains checkout remains authoritative for FEFO', () => {
  assert.match(source, /Final FEFO allocation and all transaction checks remain with POS V2 checkout/);
});
