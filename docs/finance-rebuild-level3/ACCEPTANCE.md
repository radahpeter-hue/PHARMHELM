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
