import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type Evidence = {
  file: string;
  markers: RegExp[];
};

type CertificationRequirement = {
  requirement: string;
  evidence: Evidence[];
};

const certificationMatrix: CertificationRequirement[] = [
  {
    requirement: 'ordinary POS V2 sale unchanged',
    evidence: [{ file: 'tests/pos-v2-revision-replacement-contract.test.ts', markers: [/ordinary checkout remains unchanged when no revision replacement context exists/] }]
  },
  {
    requirement: 'Unit, Strip and Pack sale unchanged',
    evidence: [{ file: 'tests/multi-tier-release-candidate.test.ts', markers: [/Unit, Strip and Pack remain three distinct commercial cart lines/] }]
  },
  {
    requirement: 'FEFO unchanged',
    evidence: [{ file: 'tests/pos-checkout-v2-atomic-core.test.ts', markers: [/FEFO allocates earliest expiry first across multiple batches/] }]
  },
  {
    requirement: 'duplicate checkout protection unchanged',
    evidence: [{ file: 'tests/pos-checkout-v2-atomic-core.test.ts', markers: [/idempotency uses a dedicated attempt record and deterministic sale relationship/] }]
  },
  {
    requirement: 'Finance outbox unchanged',
    evidence: [{ file: 'tests/pos-checkout-v2-payment-outbox.test.ts', markers: [/outbox is one minimal durable POS_SALE_COMMITTED event starting PENDING/, /idempotent replay resolves the same canonical payment and outbox/] }]
  },
  {
    requirement: 'Staff Welfare unchanged',
    evidence: [{ file: 'tests/pos-checkout-v2-payment-outbox.test.ts', markers: [/existing staff-welfare split reconciles exactly to authoritative total/] }]
  },
  {
    requirement: 'institutional credit unchanged',
    evidence: [{ file: 'tests/pos-checkout-v2-payment-outbox.test.ts', markers: [/institutional credit is represented as unpaid and never as cash received/] }]
  },
  {
    requirement: 'quotation conversion unchanged',
    evidence: [{ file: 'tests/pos-v2-revision-quotation-executor.test.ts', markers: [/preserves prior conversion evidence while restoring Draft/] }]
  },
  {
    requirement: 'original seller identity unchanged',
    evidence: [{ file: 'tests/pos-v2-revision-receipt-presentation.test.ts', markers: [/keep seller, editor and replacement executor as separate audit concepts/, /without changing operator identity/] }]
  },
  {
    requirement: 'Reprint unchanged',
    evidence: [{ file: 'tests/pos-v2-revision-receipt-presentation.test.ts', markers: [/reprint preview and thermal printer use the revision presentation contract/] }]
  },
  {
    requirement: 'A4 unchanged',
    evidence: [{ file: 'tests/pos-v2-revision-receipt-presentation.test.ts', markers: [/A4 screen, browser print and deterministic PDF carry revision identity and linkage/] }]
  },
  {
    requirement: 'V2 legacy edit remains blocked',
    evidence: [{ file: 'tests/pos-checkout-v2-controlled-activation.test.ts', markers: [/legacy mutation paths cannot edit or void immutable V2 receipts/] }]
  },
  {
    requirement: 'V2 legacy void remains blocked',
    evidence: [{ file: 'tests/pos-v2-revision-ledger-integration.test.ts', markers: [/legacy mutation paths still fail closed for POS V2 receipts/] }]
  },
  {
    requirement: 'revision within 72-hour policy works',
    evidence: [{ file: 'tests/pos-v2-revision-policy.test.ts', markers: [/completed V2 sale is eligible at the exact 72-hour boundary/] }]
  },
  {
    requirement: 'revision outside 72-hour policy fails',
    evidence: [{ file: 'tests/pos-v2-revision-worker-core.test.ts', markers: [/new revision request must be claimed within the 72-hour revision window/, /outside the 72-hour revision window/] }]
  },
  {
    requirement: 'revision retry is idempotent',
    evidence: [{ file: 'tests/pos-v2-revision-submission-repository.test.ts', markers: [/deterministic document identity and an idempotent transaction/] }]
  },
  {
    requirement: 'crash and revisit recovery works',
    evidence: [
      { file: 'tests/pos-v2-revision-ledger-action.test.ts', markers: [/recovery derives the durable request identity/] },
      { file: 'tests/pos-v2-revision-replacement-recovery-matrix.test.ts', markers: [/crash after replacement checkout but before linkage resumes from the existing canonical sale/] }
    ]
  },
  {
    requirement: 'stock reversal occurs once',
    evidence: [{ file: 'tests/pos-v2-revision-inventory-executor.test.ts', markers: [/inventory executor is idempotent and fails closed on partial or conflicting reversal history/] }]
  },
  {
    requirement: 'payment reversal occurs once',
    evidence: [{ file: 'tests/pos-v2-revision-payment-executor.test.ts', markers: [/payment executor is deterministic and idempotent on exact replay/] }]
  },
  {
    requirement: 'corrected checkout occurs once',
    evidence: [{ file: 'tests/pos-v2-revision-replacement-recovery-matrix.test.ts', markers: [/recovery never creates a second sale or mutates canonical replacement payment\/outbox/] }]
  },
  {
    requirement: 'original and replacement linkage is permanent',
    evidence: [{ file: 'tests/pos-v2-revision-replacement-finalizer.test.ts', markers: [/links original and request atomically without mutating canonical replacement payment or outbox/, /completed linkage replay is accepted only after revalidating the entire canonical chain/] }]
  },
  {
    requirement: 'analytics additions and deductions are correct',
    evidence: [{ file: 'tests/pos-v2-revision-ledger.test.ts', markers: [/branch analytics calculate original, corrected, additions, deductions and net values/] }]
  }
];

function source(file: string): string {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
}

for (const item of certificationMatrix) {
  test(`Stage 8F evidence: ${item.requirement}`, () => {
    for (const evidence of item.evidence) {
      const contents = source(evidence.file);
      for (const marker of evidence.markers) assert.match(contents, marker, evidence.file);
    }
  });
}

test('Stage 8F evidence is executed by the full local and CI test command', () => {
  assert.match(source('package.json'), /"test":\s*"node --import tsx --test tests\/\*\.test\.ts"/);
  assert.match(source('.github/workflows/pos-v2-foundation-ci.yml'), /- name: Run tests\s+run: npm test/);
  assert.match(source('.github/workflows/pos-v2-foundation-ci.yml'), /tests\/pos-v2-revision-\*\.test\.ts/);
});

test('Stage 8F records the current conservative first-claim cutoff without changing it', () => {
  const core = source('scripts/pos-v2-revision-worker-core.mjs');
  const worker = source('scripts/process-pos-v2-revisions.mjs');

  assert.match(core, /const suppliedRequestMillis = millis\(requestCreatedAt\)/);
  assert.match(core, /Number\.isFinite\(suppliedRequestMillis\) \? suppliedRequestMillis : Date\.now\(\)/);
  assert.match(worker, /validateRevisionRequest\(\{ request: validationRequest, sale, payment, outbox, resume: resumingOwnLock \}\)/);
  assert.doesNotMatch(worker, /requestCreatedAt:\s*requestSnap\.createTime/);
});
