# PHARMHELM Finance Rebuild Level 3

## Baseline

- Base branch: main; exact base: e6c12d8d8daf184896c6328c46de1b5e8294ab56.
- Latest successful production deployment: Actions run 40690667542 at this exact SHA.
- PR #93: Levels 1–2, money normalization/reasons and finance presentation.
- PR #94: immutable staff numbers, IT Head-only EOD corrections, 14-day Kampala lock.
- PR #95: confirmed staff aliases/retirement, readable petty-cash reports and narrow authority guards.
- Clean clone of current main, not PR #92 or an experimental branch.
- Existing EOD: random document IDs, explicit reconciliation_date, whole-day POS totals, no stored shift attribution; Settings stores branch.shifts.{dayShift,eveningShift,nightShift} with enabled/startTime/endTime. Analytics guesses shifts from current configuration; that is not historical evidence.
- EOD creation only adds a reconciliation; CashAndBanking derives financial balances from declarations (review under 031).
- Correction service preserves only the latest correction metadata; history reviewed under 029.
- Rules source: 196,869 bytes. Existing EOD read disallows missing documents; create permits random IDs. Narrow rules work may be needed for transactional creation. No compaction redesign is authorised.
- Baseline: npm test: 750/750; npm run typecheck: PASS.

## Sequential checkpoints

### 023 — accepted

Use existing reconciliation_date as the canonical business date; validate actual YYYY-MM-DD values. Default and POS day comparison use Africa/Kampala, independent of browser timezone/UTC midnight. History's month range uses the same date. Previous dates remain supported. No historical document migration or rewrite.

Validation: node --import tsx --test tests/finance-rebuild-level3-date.test.ts tests/finance-rebuild-eod.test.ts tests/eod-edit-policy.test.ts: 13/13 PASS. npm run typecheck: PASS. Covers ordinary/previous/invalid dates, midnight boundary, equivalent offsets, ambiguous timestamp exclusion, legacy history and correction deadline; Level 2 monetary tests retained.

### 024 — accepted

Added configured-shift selection, immutable branch Settings field key and display/hour snapshot to new EOD records. Branch/date/shift/tenant form the conceptual identity; no shift defaults or historical attribution are invented. Missing configuration blocks submission. Actual transactional uniqueness follows in 028.

Validation: targeted date/shift/money/correction tests: 15/15 PASS; typecheck PASS. Same branch/date different shifts, same shift other dates/branches/tenants, disabled and absent configuration covered.

### 025 — accepted

EOD subscribes to saved tenant-scoped branch configuration and uses the same immutable keys and display vocabulary as Settings. Settings editor defaults remain editor-only: unsaved/nonexistent configuration is never substituted into EOD. Live settings updates invalidate disabled choices. Captured name/hours remain historical snapshots.

Validation: targeted date/shift/money/correction tests: 16/16 PASS; typecheck PASS. Toggle and time-change tests confirm future choices update without modifying captured definitions.

### 026 — accepted

Legacy and V2 checkout capture `eodShift` from the live branch configuration read inside their inventory transaction. The starting Kampala date owns overnight shifts; end time is exclusive. Missing/gap/overlapping configuration leaves explicit absence of attribution and never blocks unrelated POS sales. EOD expected totals strictly filter tenant, branch, saved business date and saved shift ID; voided/superseded receipts remain excluded. Historical sales are not backfilled or classified from today's settings; the form displays excluded unattributed-sales counts for the business-day window.

Validation: date/shift/sales/money/correction/POS checkout tests: 96/96 PASS; typecheck/build PASS; actual Finance/Welfare UI checks at 360/390/1280px PASS (including match, shortage, over, float, tiny, correction roles); existing POS Spark emulator suite PASS (quotation lifecycle, atomic revision/stock/payment, revision RBAC, legacy repair). Runtime-only cached firebase-admin and Chromium supplied to existing harnesses; no dependency/lockfile changes. A first strict float assertion was corrected to use the accepted Level 2 normalized variance contract; no money behavior changed. Initial harness environment failures (absent browser/admin module) resolved before acceptance.

### 027 — accepted

A synchronous ref guard locks before the first async operation; fieldset/button disable immediately with visible submitting text. Finally releases on success/error, retaining failure input. This is interaction protection only; server-atomic uniqueness follows in 028.

Validation: targeted date/shift/sales/money tests: 17/17 PASS; typecheck PASS; complete actual Finance/Welfare responsive harness PASS including synchronous double-click plus synthetic click during a delayed write: exactly one write, disabled shift selector and visible progress, normal completion.

### 028 — accepted

Canonical document ID: `eod~tenant~branch~YYYY-MM-DD~shiftKey`; separator/path collisions rejected. The transaction rechecks current branch/shift and live operator branch membership, then creates the deterministic audit with unique submission metadata. Existing production EOD update predicates permit only correction fields, so a second set cannot replace submission metadata, even for IT Head. A tenant/date list lookup avoids production Rules' denial of missing-document point reads. Concurrent losers and uncertain acknowledgements resolve to the existing ID; no correction/overwrite occurs. Queries use equality filters on existing indexed scalar fields; no new index/config/rule deployment.

Validation: EOD_LEVEL3_ONLY=1 node scripts/run-staff-eod-emulator.mjs PASS against authenticated compiled production predicates. A normal; B simultaneous same-client; C independent authenticated sessions with conflicting declarations; D lost-acknowledgement retry; E shift; F date; G branch; H tenant isolation all PASS. Wrong assignment, disabled shift, missing variance reason and raw overwrite attempts by cashier/IT Head rejected. Seventeen targeted tests, typecheck, complete responsive Finance/Welfare UI harness PASS. No Rules changes or compaction performed. Creation-only behavior depends on the existing EOD correction field allowlist and is explicitly regression-tested.

### 029 — accepted

Branch-scoped date-filtered history is accessible beneath reconciliation; management retains tenant-wide history. Rows/exports include saved shift identity, legacy whole-day records are explicit, and audit details show amounts, submitter/time, reason and correction metadata. Each IT Head correction now atomically creates a fresh `audit_logs` event with complete before/after snapshots, actor, timestamp and reason alongside the original allowed update. Expected amounts/date/shift and original submission metadata remain fixed. Existing historical documents are not migrated. Pre-Level-3 earlier correction versions cannot be reconstructed; latest legacy metadata is retained. Existing audit collection permissions are unchanged; this is an application append workflow, not a new audit-security architecture.

Validation: authenticated Level 3 emulator PASS including two successive corrections, retained before-images and independent reconciliation history, non-IT and fourteen-day lock. Forty-two finance/date/shift/money/correction tests PASS; typecheck PASS; responsive Finance/Welfare harness PASS including branch-locked history, previous dates, audit detail and exported shift labels. No Rules changes.

### 030 — accepted

Each channel/grand-total row now explicitly shows Expected, Declared and Variance with Balanced/Shortage/Overage labels. History and exports present expected and declared totals separately; no EOD declaration is labelled revenue. Audit details include per-channel variances. Existing money normalization, zero and required-reason functions are unchanged.

Validation: 42 finance/date/shift/money/correction tests PASS; typecheck PASS; actual responsive UI suite PASS for exact/shortage/over/floating/tiny amounts, declared/expected/variance text, no negative zero, offsetting discrepancies, history and exported expected/declared values.

### 031 — accepted

Submission is marked audit-only/no-financial-posting and writes only the EOD reconciliation. Removed Cash & Banking's EOD query and use of declarations as bank/wallet funding or welfare spending. Registered bank balances, recorded transfers, receivables and recorded welfare allocations remain intact. No substitute account/ledger architecture is introduced. Wallet/current welfare reserve values that were only inferred from EOD are explicitly unavailable, and cannot fund a Process-to-Bank action. This is a necessary consequence of removing fictitious EOD funding, not a new wallet implementation. Existing staff Welfare Portal behavior/balances and manual allocation service are unchanged.

Validation: 44 finance/date/shift/money/correction tests PASS; typecheck PASS; responsive Finance/Welfare UI harness PASS, including EOD-only writes and no declaration-funded bank/wallet/reserve values. Authenticated Level 3 emulator PASS: controlled POS 500,000 exact and 495,000 shortage; reason required, variances 0/-5,000, one reconciliation each. Byte-for-byte collection snapshots show sales, canonical payments/outbox, revenue/finance ledgers, bank records, registered balances, petty-cash/credit and transfer records unchanged. No invented balancing movements.

### Regression follow-up — canonical EOD report fields

Inspection found Report Hub still using obsolete date/shift/expected fields and substituting expected MoMo for declared zero. It now uses canonical business date, saved shift, expected/declared/normalized variance, reason and actual zero. Legacy date/total shapes remain readable without rewriting records.

Validation: 10 focused money/report tests PASS; typecheck PASS.

### Responsive Settings regression — accepted

Actual Settings-to-EOD browser tests save changed day-shift hours and disable evening shift, then mount EOD against the same saved fixture store. EOD offers only the updated saved choices and records the new hours. Verified at 360px and 1280px. The test exposed existing Settings tab-bar page overflow at phone width; the bar is now horizontally scrollable within its viewport. Complete Finance/Welfare/EOD/Settings browser suite passes with no page overflow or runtime/backend requests.

## Complete local regression — PASS

- `npm test`: 763/763 PASS (baseline 750 plus Level 3 date, shift, sales and audit/report cases).
- `npm run typecheck`: PASS.
- `npm run build`: PASS. Existing large-bundle advisory remains; no dependency/config changes.
- `node scripts/run-staff-eod-emulator.mjs`: PASS. Level 3 A–H concurrency, retry, live branch Settings, exact/shortage no-financial-mutation snapshots, repeated correction history; actual V2 checkout/replay capturing live shift; existing staff permanence, retired identity, HR/IT, tenant, deadline and Martin Pharma synthetic staging regressions.
- `node scripts/run-pos-v2-spark-emulator.mjs`: PASS. Quotation, atomic stock/payment revision, RBAC and controlled legacy receipt repair scenarios (run at 026; no later checkout changes).
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 node scripts/management-cash-settlement-rules-emulator.mjs`: PASS. Registered account control, full/partial payments, insufficient funds, competing writers, bank/cash settlement, tenant/role isolation and rollout gate unchanged.
- `FINANCE_LEVEL=2 node scripts/finance-rebuild-ui-smoke.mjs`: PASS against actual Finance/Welfare/Settings components, isolated fixtures and local Chromium. Phone 360/390px, desktop 1280px; Settings save→EOD, exact/shortage/over/float/tiny, rapid clicks, history/export, correction roles and audit-only Treasury. Screenshots visually reviewed. No live backend requests/writes.
- `node scripts/management-cash-settlement-ui-smoke.mjs`: PASS at 360/390/1280px, full/partial supplier payment, account/insufficient-funds guards, retry identity. Local temporary harness selects cached Chromium; the versioned harness remains unchanged and CI uses its standard installed browser.
- `node --import tsx --test tests/finance-rebuild-preview.test.ts`: PASS. Preview deploys validated PR head only, never production/rules/indexes.
- `git diff --check`: PASS.
- Rules, indexes, Firebase config, package manifest/lockfile: byte-for-byte unchanged from base. Source Rules remain 196,869 bytes. No rules-size expansion or new runtime predicates. Existing authenticated success and denial scenarios pass; source compaction compiler remains unchanged. Some pre-existing negative staff/settlement cases log expression-cap denials; no broader rules work undertaken.

## Owner live acceptance — Martin Pharma / Masaka

Preview shares the established Firebase backend and existing tenant permissions. Use authorised test accounts/records; automated verification used isolated fixtures and did not seed or edit Martin Pharma finance data.

1. Confirm current Settings shift IDs/enabled hours and select Masaka. A shift's business day is its starting date in Kampala.
2. Use new preview POS activity with saved shift attribution. Reconcile a shift expecting 500,000 with declaration 500,000: zero variance, no required reason, one saved audit and correct shift/date.
3. On a separate test date/shift (or through permitted correction), declare 490,000 against 500,000: shortage 10,000, reason required. A second submission to the same key retains the first audit; it is not a correction mechanism.
4. Reconcile a different enabled shift on the same date: separate record; verify only that shift's expected sales.
5. Rapid click/retry from one or two sessions: only one audit per canonical key; existing result is returned on replay.
6. Check branch/date history and export; view actor/timestamp/reason and saved corrections. IT Head can correct inside 14 days, other roles cannot; existing older records remain locked.
7. Compare POS sale/payment and treasury records before/after EOD: no added sale, revenue, bank deposit or balancing movement. Registered bank balance remains unchanged.
8. Verify phone and desktop views, Finance visibility and existing Welfare/expense/petty-cash/P&L behavior.

## Known limits and deferred findings

- Historical POS receipts lack reliable stored shift evidence. They are excluded from shift totals with a visible warning; no retrospective guessing/backfill. Configure non-overlapping enabled shifts; uncovered/overlapping sale times stay unattributed.
- Earlier correction versions cannot be reconstructed from legacy last-correction fields. Level 3 appends new before/after audit events using the existing audit collection permissions; no new audit-permission architecture is claimed.
- Removed EOD-inferred wallet/current welfare reserve values are unavailable rather than presented as money. Existing allocation records and registered bank/control balances are preserved. Authoritative channel accounts, transfers/reversals and POS financial funding remain for Levels 4–6.
- No Branch Cash Sales, bank/MTN/Airtel ledger redesign, Petty Cash redesign, portfolio-transfer/charge implementation, POS BCS funding/reversals, supplier-payables/receivables or P&L accounting redesign performed.
- Owner authenticated live acceptance is pending; isolated automation is not a claim of owner acceptance.

## Release control

Dedicated branch: feature/finance-rebuild-level3-eod. Preview workflow is limited to the established seven-day Finance PR Hosting channel and reuses its existing service account. CI must validate/deploy the exact head build before recommendation. No production merge/deploy is authorised; stop after preview is available for owner acceptance.

### CI security maintenance

The first POS CI audit detected newly published GHSA-gg6h-894w-4m9c in baseline re2js 2.8.6. Updated only its lockfile entry to 2.9.1 (four lines); no manifest or other dependency changes. Fresh npm ci, production dependency audit (zero vulnerabilities), all 763 tests and TypeScript pass. Production build revalidated. Audit gates remain enabled. Earlier statements that the lockfile was unchanged describe the Level 3 feature checkpoints before this narrow CI repair.
