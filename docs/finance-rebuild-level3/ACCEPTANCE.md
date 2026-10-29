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
