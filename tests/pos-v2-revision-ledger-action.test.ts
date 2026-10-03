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

test('eligible ledger action opens the dedicated local-only revision editor', () => {
  const source = readFileSync('src/components/sales/PosV2ReceiptRevisionAction.tsx', 'utf8');
  assert.match(source, /PosV2ReceiptRevisionEditor/);
  assert.match(source, /setIsEditorOpen\(true\)/);
  assert.match(source, /onCancel=\{cancelRevisionFlow\}/);
  assert.match(source, /onContinue=\{continueToReview\}/);
});

test('editor draft advances to the dedicated review screen and can return to edit', () => {
  const source = readFileSync('src/components/sales/PosV2ReceiptRevisionAction.tsx', 'utf8');
  assert.match(source, /PosV2ReceiptRevisionReview/);
  assert.match(source, /setReviewDraft\(draft\)/);
  assert.match(source, /onBack=\{backToEditor\}/);
  assert.match(source, /setReviewDraft\(null\)/);
  assert.match(source, /onConfirm=\{holdReviewedDraft\}/);
  assert.match(source, /Durable submission will be enabled in the next controlled checkpoint/);
});

test('review confirmation is still non-durable and cannot invoke legacy or checkout mutation services', () => {
  const source = readFileSync('src/components/sales/PosV2ReceiptRevisionAction.tsx', 'utf8');
  assert.match(source, /getPosV2ReceiptRevisionUiDecision/);
  assert.doesNotMatch(source, /firestoreService/);
  assert.doesNotMatch(source, /reviseSaleInventoryAtomically/);
  assert.doesNotMatch(source, /voidSaleInventoryAtomically/);
  assert.doesNotMatch(source, /executeCheckoutV2/);
  assert.doesNotMatch(source, /updateDocument|addDocument|setDoc|updateDoc|deleteDoc/);
});

test('ineligible V2 revision states are rendered disabled rather than routed into legacy edit', () => {
  const source = readFileSync('src/components/sales/PosV2ReceiptRevisionAction.tsx', 'utf8');
  assert.match(source, /disabled=!\{?decision\.canRevise\}?|disabled=\{!decision\.canRevise\}/);
  assert.doesNotMatch(source, /onEditInPOS|onEdit\(/);
  assert.match(source, /Revision Window Expired/);
  assert.match(source, /Corrected Receipt/);
});
