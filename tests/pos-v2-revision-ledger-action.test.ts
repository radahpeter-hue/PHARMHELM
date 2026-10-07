import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getPosV2ReceiptRevisionActionLabel,
  getPosV2ReceiptRevisionRemainingLabel
} from '../src/components/sales/PosV2ReceiptRevisionAction';

function decision(state: any, overrides: Record<string, unknown> = {}) {
  return {
    state,
    canRevise: state === 'ELIGIBLE',
    showReviseAction: true,
    deadline: null,
    remainingMs: null,
    message: 'message',
    ...overrides
  } as any;
}

const source = readFileSync('src/components/sales/PosV2ReceiptRevisionAction.tsx', 'utf8');

test('ledger action labels clearly distinguish revision lifecycle states', () => {
  assert.equal(getPosV2ReceiptRevisionActionLabel(decision('ELIGIBLE')), 'Revise Receipt');
  assert.equal(getPosV2ReceiptRevisionActionLabel(decision('WINDOW_EXPIRED')), 'Revision Window Expired');
  assert.equal(getPosV2ReceiptRevisionActionLabel(decision('REVISION_IN_PROGRESS')), 'Revision In Progress');
  assert.equal(getPosV2ReceiptRevisionActionLabel(decision('ORIGINAL_REVISED')), 'Receipt Revised');
  assert.equal(getPosV2ReceiptRevisionActionLabel(decision('REPLACEMENT_RECEIPT')), 'Corrected Receipt');
  assert.equal(getPosV2ReceiptRevisionActionLabel(decision('NO_PERMISSION')), 'Revision Unavailable');
});

test('remaining revision window is presented without changing the authoritative deadline', () => {
  assert.equal(getPosV2ReceiptRevisionRemainingLabel((5 * 60 + 12) * 60_000), '5h 12m remaining');
  assert.equal(getPosV2ReceiptRevisionRemainingLabel(37 * 60_000), '37m remaining');
  assert.equal(getPosV2ReceiptRevisionRemainingLabel(0), null);
  assert.equal(getPosV2ReceiptRevisionRemainingLabel(null), null);
});

test('eligible ledger action opens the dedicated revision editor and review flow', () => {
  assert.match(source, /PosV2ReceiptRevisionEditor/);
  assert.match(source, /PosV2ReceiptRevisionReview/);
  assert.match(source, /setIsEditorOpen\(true\)/);
  assert.match(source, /setReviewDraft\(draft\)/);
  assert.match(source, /onBack=\{backToEditor\}/);
  assert.match(source, /onConfirm=\{submitReviewedDraft\}/);
});

test('review confirmation commits an immediate atomic correction and monitors its immutable evidence', () => {
  assert.match(source, /commitPosV2ReceiptCorrection/);
  assert.match(source, /watchPosV2RevisionRequest/);
  assert.match(source, /PosV2ReceiptRevisionProgress/);
  assert.match(source, /profile\.uid/);
  assert.match(source, /if \(!canOperatePos\)/);
  assert.match(source, /You no longer have permission to revise POS receipts/);
  assert.doesNotMatch(source, /firestoreService/);
  assert.doesNotMatch(source, /reviseSaleInventoryAtomically/);
  assert.doesNotMatch(source, /voidSaleInventoryAtomically/);
  assert.doesNotMatch(source, /updateDocument|addDocument|setDoc|updateDoc|deleteDoc/);
});

test('revision recovery derives the durable request identity from the original sale revision id', () => {
  assert.match(source, /posV2RevisionRequestIdForRevision/);
  assert.match(source, /decision\.state !== 'REVISION_IN_PROGRESS'/);
  assert.match(source, /sale as any\)\.revisionId/);
  assert.match(source, /watchPosV2RevisionRequest/);
});

test('canonical replacement checkout runs only after the durable request reaches REPLACEMENT_PENDING', () => {
  assert.match(source, /executePosV2RevisionReplacement/);
  assert.match(source, /REPLACEMENT_PENDING/);
  assert.match(source, /replacementAttemptRef/);
  assert.match(source, /canOperatePos/);
  assert.doesNotMatch(source, /executeCheckoutV2\s*\(/);
});

test('ineligible V2 revision states remain disabled and never route to legacy edit or void', () => {
  assert.match(source, /disabled=!\{?decision\.canRevise\}?|disabled=\{!decision\.canRevise \|\| isSubmitting\}/);
  assert.doesNotMatch(source, /onEditInPOS|onEdit\(/);
  assert.doesNotMatch(source, /voidSaleInventoryAtomically/);
  assert.match(source, /Revision Window Expired/);
  assert.match(source, /Corrected Receipt/);
});
