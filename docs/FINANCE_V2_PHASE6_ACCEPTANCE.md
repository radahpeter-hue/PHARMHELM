# Finance V2 Phase 6: Credit Receivables and Settlement

## Baseline and release boundary

Phase 6 is stacked on PR #90, branch `feature/finance-v2-phase5-hr-advance-validation-20261021`, commit `c542ce834a60b0a21a9ea278b9dd90ab60fd8a17`. On 26 October 2026, PRs #88, #89 and #90 were draft, open and unmerged; main was `4f6ef5706b22b6e8addf6e352568f2bf775e9f62`. This branch must not be rebased onto older main without preserving its Phase 5 dependency. No merge, Hosting publication, rules/index deployment, tenant activation, live collections or balance migration is authorized by this development work.

The original Phase 3 shift/EOD and generalized transfer implementation is on a separate unmerged branch and is not fully present in the Phase 5 baseline. Existing baseline EOD totals and payroll/welfare contracts are preserved. Phase 6.4 must explicitly reconcile this integration dependency; Phase 6 does not certify the old generalized transfer pathway.

## Authoritative scope reconciliation

No inspected repository roadmap or supplied specification assigns the formal number "Phase 6" to receivables. The owner's current assignment establishes that phase label. The underlying functionality is supported by:

- Module 6 Finance specification, sections 9.1 and 9.2: individual/client and institution receivables, source receipts, partial settlements and aging. Supplier payables remain a different obligation direction.
- Module 3 CRM specification, sections 2.2, 4.2 and 8.3: shared client/institution identities, approved credit policies, one underlying receivables dataset for CRM and Finance.
- Module 1 POS specification, sections 5 and checkout: credit and insurance produce receivables and sales deduct inventory.
- Modification instructions 1: receivables arise from POS, not manual Finance ledger entries.
- Finance Management Operations Build Prompts: its initial "Credit Ledger" schema concerns supplier payables, while its treasury section also requires customer/institution receivables. Existing separate payable and receivable tabs are preserved.

Differences retained for later milestones: original specifications include insurance receivables, 0–30/31–60/61–90/91+ age categories, a 365-day default/bad-debt workflow, and institution credit-limit overrides. These are not silently replaced by the handoff's proposed overdue buckets or unapproved write-offs. Phase 6.3 must distinguish invoice age from overdue age and reconcile those policies. The supplied documents do not establish a numbered Phase 7–9 roadmap.

## Milestone 6.1 investigation, before changes

1. POS V2 committed inventory, sale, immutable payment and outbox together. Full institutional credit was an unpaid payment component. The only split was staff welfare plus cash/mobile money.
2. `postInstitutionalCredit` in the Admin downstream worker later created `credit_receivables/{saleId}`. A pending worker therefore left a completed sale without an authoritative receivable; this is unsuitable as a required Spark production posting dependency.
3. Management Credit Ledger synthesized receivables from sales, sometimes using the whole invoice as debt, patient ID ahead of billable institution ID, and sale date as an invented due date. Branch Finance and CRM separately reconstructed balances from sales. Manual Finance invoice/receivable forms permitted ledger insertion, amendment and deletion.
4. Firestore explicitly allowed Finance roles to create/update/delete arbitrary tenant receivables. Ordinary recognition had no independently enforced source/debtor/arithmetic contract. Receipt corrections had a separate atomic credit contract.
5. The canonical CRM collections are `clients` and `institutions`. Institution IDs are document IDs; `supplier_name` is the established institution display-name field. Client institutional billing uses `institution_to_bill_id`.
6. Canonical V2 account services use `finance_payment_accounts`, `finance_v2_events` and `finance_v2_account_movements`. Existing management cash uses its own already-established version-1 account contract. No second account or movement model was added.

## Milestone 6.1 implementation

- One authoritative `credit_receivables/{saleId}` is created in the same transaction as POS inventory, sale, immutable canonical payment and outbox. Recognition posts neither a second sale/revenue entry nor an account movement.
- The existing internal credit method is retained; individual customers use canonical CRM client IDs and institutional debts use the institution ID. A client configured for institutional pay must use its registered billing institution. Cross-tenant, ineligible/blacklisted, branch-incompatible and missing masters fail closed. Debt identity and source linkage cannot be edited directly, including by Finance or tenant owner.
- A positive immediate cash/MTN/Airtel component below the invoice amount is supported. Only the unpaid component becomes debt. Existing EOD/credit summaries distinguish the immediate component from credit rather than treating the entire invoice as received money.
- Schema reuses established snake-case amounts and branch/source fields. `invoice_amount_ugx` is the original invoice; `amount_ugx` is initial unpaid principal; `outstanding_ugx` is remaining principal. Later collections are derived from initial principal minus outstanding, not independently duplicated. `debtorType`, `debtorId`, `paymentId`, `recognizedBy`, `controlVersion: 2`, currency and immutable timestamps identify verified recognition.
- Approved CRM payment terms are snapshotted. No client-supplied due date is accepted. Recognized known terms (Net/Credit 30/60/90) provide a derived due date; absent or unrecognized terms remain unverified. Legacy due dates are not assumed reliable.
- Finance, branch operations and CRM use the same read-only register and branch-scoped loader. It provides source/reference and history, debtor/contact, branch, full invoice/initial debt/collected/outstanding amounts, filters, pagination, age, due-date exceptions and export. CRM name/contact edits resolve live from the master without relinking the debt.
- Historical records, duplicate source rows and sales without recognized debt remain visible reconciliation exceptions. They are excluded from verified totals and are not migrated or silently converted into new debts. Treasury's receivables figure uses the verified register.
- Removed obsolete manually editable Finance receivable/invoice screens. Supplier payable behavior remains separate. New canonical receivables cannot be collected using the old automatic-bank shortcut while 6.2 remains uncertified.
- Preserved the independently tested legacy management-bank settlement, requiring its fresh bank movement and linked transfer for debt reduction. Its synthetic regression fixture now declares the HQ branch explicitly.
- The downstream worker validates and leaves new canonical recognition intact. Historical worker records keep unknown due dates. Receipt corrections preserve the original business timestamp in their replacement debt and continue using immutable reversal evidence.
- No infrastructure dependency was introduced. Production posting remains client transactions plus independently enforced Firestore rules on Spark.

## Milestone 6.1 verification and status

Local checks: 771 unit tests pass; TypeScript and production build pass. Nineteen authenticated recognition scenarios pass against the release-transformed application rules, with production checkout code bundled against an isolated Firestore connection. The full existing Spark POS correction suite and Management Cash/Bank settlement suite pass. Neither service calls nor rules are mocked in financial acceptance.

Recognition scenarios cover institutional and individual credit, partial arithmetic, retry/concurrent identity, unchanged bank/no movement, stock deduction, forged debtor/negative/fractional/unsafe amounts/wrong invoice/wrong tenant/forged due date, missing source/payment/receivable, cross-tenant master and biller mismatch, owner/Finance mutation/deletion denial, branch/tenant read isolation, and payment-component forgery. Evidence is `/tmp/phase6-recognition-acceptance.json`, uploaded by CI as `phase6-recognition-evidence`; CI inserts the exact head commit in every scenario.

UI testing uses the real register component with explicitly stubbed read-only fixtures, separately from authenticated financial tests. Local Chromium installation failed because browser downloads were truncated. CI must run phone-width UI verification and attach screenshots; no live workspace UI acceptance is claimed.

Acceptance remains **pending exact-commit CI**, including Phase 6 Credit Spark validation, Phase 5 Payroll Spark validation, POS V2 Foundation, Management Cash settlement, actual compiled Firestore release size and Hosting build/check workflow. The existing compiler verifier and its exact-source/unbound-release proof are retained. The Hosting publication step is skipped for this Phase 6 development branch under the owner's no-deployment instruction.

## Sequential gate

6.1 is not accepted until its exact-commit checks pass and the acceptance result is recorded. 6.2 collections, 6.3 credit control/statements/reconciliation and 6.4 full security/integration acceptance have not started. Phase 6 is not signed off. Production deployment and authenticated live Martin Pharma workspace acceptance remain separate.

### First CI candidate: 9fa46c056a220f53bf81cbc6c6b87ea81558d49a

- Phase 6 authenticated recognition, Management Cash and full POS correction tests passed in run 40304704420. The job then failed installing Playwright 1.51.1 on the newly updated Ubuntu 26.04 runner. The UI job is now pinned to Ubuntu 22.04; this does not skip browser verification.
- Phase 5 Payroll Spark validation passed, run 40304704396, including its authority/financial tests and 20 controlled scenarios.
- Hosting build/check passed, run 40304704305, with publication skipped.
- The actual compiled-size gate (run 40304704450) failed on repeated Rules API HTTP 503 responses. Its certified control also returned 503; minimal and source-size-matched deny-all diagnostic controls compiled. These are diagnostics, not candidate size certification. The existing exact-source recovery and actual unbound-release verifier are unchanged and mandatory.
- Follow-up UI corrections remove the obsolete CRM sales-derived export path entirely, show loading/failed totals as unverified, and expose source invoice items in history. Required CI filters now rerun on changes to this acceptance record and the shared register. Final acceptance is recorded against the exact tested head in PR #91, after all mandatory checks succeed.

The follow-up also covers the established `Sale.clientId` alias used by customerId-only checkout requests. Its customer-alias authenticated scenario confirms this alias resolves to the same CRM client without changing the source, payment or inventory contract. Initial checkout payment and later credit collection are explicitly labelled separately in the register.

Compiler-control refinement: the inherited workflow still referenced the earlier 8e7f7ea control, whose historical transformation produces 140,968 bytes. The control is now pinned to the actual Phase 5 signed-off c542ce8 source and transformer, with a mandatory SHA-256 assertion `5162b4f375af5a9cc288a3502659e3e7833bf1fcf7c6bd4e35e20cce2fae40ad` (135,930 bytes), independently reproduced locally. This improves the diagnostic baseline; success of that control still cannot certify the Phase 6 candidate, and the real candidate unbound-release gate is unchanged.

A nineteenth raw authenticated denial also prevents the canonical payment customer alias from contradicting the source sale.

Visual QA of the actual phone-width CI screenshots found inherited white text on pale financial summary cards because the application's body theme is dark. The register now declares its own light surface, dark text and input color scheme. Browser acceptance additionally measures financial-total contrast (minimum 4.5:1), so this regression cannot pass on layout assertions alone.

The bcb093f compiled-size run recovered the exact newly uploaded candidate after an ambiguous 503. The subsequent mandatory unbound-release probe still returned HTTP 503 with GET recovery 404. That is not a successful compiled-size certificate; the verifier remains unchanged and acceptance remains blocked pending a successful exact-head probe.

Removed the now-unreferenced old correction-only receivable creation helper. All new debts, including replacement receipts, use the same canonical recognition validator; the existing protected reversal/update contract remains. This reduces compiler input without removing any active authorization check.

For an evidenced compiler blocker, the size workflow now runs the same unchanged verifier against the exact c542ce8 control after candidate failure, using a separate run-owned unbound probe. A successful diagnostic control cannot override the failed candidate step. This distinguishes candidate-specific activation failure from failure affecting the previously certified executable; no production release binding is modified.

The exact c542ce8 activation diagnostic eventually passed after prior 503/404 responses. To test the same late-completion behavior safely for the new candidate, the existing verifier now gives its final ambiguous unbound-release creation a bounded additional 60-second read-only recovery window. Success still requires the exact probe name and exact new candidate ruleset; size rejection, conflict and persistent absence still fail. Three additional tests cover delayed exact success, delayed conflict and persistent absence. No emulator-only or source-size substitute is accepted. The baseline diagnostic uses an explicit child-process operation suffix because GitHub's reserved default environment variables override a step-level env assignment.

Final screenshot review also checks table values and headings, not only summary cards. The table explicitly declares its foreground color and the isolated browser fixture uses the production HTML standards doctype. Contrast assertions cover cards, debtor cells and headers.

### Compiled-size defect and correction, 27 October 2026

Commit `e04acbaa7fd902afecd459303dd96f8ad5b187c4` passed Phase 6 Credit Spark (40308705092), Phase 5 Payroll Spark (40308705310), POS Foundation (40308705315) and Hosting build/check (40308705360, publication skipped). Management Cash financial and UI tests passed, but its mandatory real release probe (40308705141) returned HTTP 400: compiled executable 261,759 bytes exceeds the strict 256,000-byte ceiling. This is an actual size defect, not merely the intermittent Rules API 503 failure. Milestone 6.1 remains blocked.

The equivalent release transformer now shares repeated global `request.resource.data` and `resource.data` map access through zero-argument helpers. Access remains at the original evaluation site, preserving missing-resource guards and all field, tenant, branch, authorization and transaction checks. A regression test covers lazy guards, quoted strings and unrelated property chains. Compact source decreases from 140,523 to 132,421 bytes; source bytes alone do not certify compiled size. All 772 unit tests, TypeScript checks and production build pass locally. Exact-head authenticated regressions and the unchanged real compiled-release verifier must pass in CI before acceptance.

The `a7c0705` global accessor candidate passed credit, payroll and Hosting checks, but POS Foundation correctly exposed a legitimate Operational Inventory transaction exceeding the 1,000-expression evaluation ceiling. Its size probe and the independent c542ce8 activation control both returned ambiguous HTTP 503/404. That candidate is not accepted. The broad accessor transform is removed; the established release transformer and verifier are restored.

The replacement uses explicit local map bindings in 21 existing create/update validators. Each requested map is available for create/update; existing maps are bound only in validators invoked for updates. No authorization predicate, document path, monetary constraint or immutable field is removed or changed. In particular, the generic identity validator remains behind its update-method guard. This reduces repeated map traversal without introducing extra accessor calls. Existing source-shape tests are updated for the explicit aliases; authenticated tests retain their assertions unchanged. Local regression execution includes all ten Operational Inventory, procurement, dispatch, supplier and system/Martin identity suites in POS Foundation, followed by credit, Management Cash and full POS correction suites. Exact-head hosted compiler proof remains mandatory.

### Auditor-assisted compiler investigation

The requested Google Firebase security-rules auditor skill (`firebase/agent-skills`, SKILL.md blob `18d1abac06cd7f2a6546fc05d6590e43e770a1ad`) is being applied to authority sources, overlapping matches, create/update bypasses, types and resource limits. No whole-application security score or successful milestone acceptance is inferred from the earlier tests.

Run 40505093177 attempt 2 shows candidate ruleset requests failing in 5.1 seconds while minimal deny-all and source-size-matched deny-all controls succeeded in 80 and 134 milliseconds. Keeping functions but denying all permissions succeeded in 3.5 seconds; removing only the generic fallback did not fix compilation. This is evidence for a complexity/deadline hypothesis, not proof of a general Firebase outage. The 785-rule inventory is below the documented 2,500 ruleset ceiling.

A separate verifier discrepancy is being tested: source names used long random operation identifiers instead of the configured deployment filename `firestore.rules`. The verifier now uses that production name and the Rules API's documented File.fingerprint metadata for unique run ownership. Ambiguous recovery still requires exact name, source bytes, recent creation and the exact fingerprint; a missing or different fingerprint fails closed. The unique unbound release, actual size enforcement, conflicting-probe denial and owned cleanup are retained. A separate filename comparison runs the same verifier against the same bytes; its result cannot override the mandatory canonical candidate gate. Filename influence on executable size or timeout remains a hypothesis until hosted evidence establishes it.

### Reproduced auditor findings and repair

Against the pre-audit rules (68b7357 and the unchanged financial rules at 8541d49), the authenticated auditor fixture reproduced 22 unauthorized operations in 25 probes: users lacking CRM operation rights could create/edit masters, ordinary CRM users could overwrite welfare balances/limits, master records could be physically deleted, and foreign Finance could create/update/delete all four old ledger collections. A separate genuine bank/receivable batch also settled a Masaka legacy debt through an HQ-only Finance identity; the baseline test failed because that unauthorized request succeeded. These are application defects, not compiler-service failures.

Dedicated CRM rules now enforce authoritative active primary/secondary roles and owner-approved custom realms, tenant and optional branch ownership, immutable identity codes, and separation of ordinary contact maintenance from financial welfare state. Debtor masters are archived rather than deleted, so existing source identity and outstanding totals survive. Marketing's approved client-registration and consent workflows remain available with restricted fields; custom Finance/POS roles can resolve canonical master identities without CRM editing authority. Credit limits require safe nonnegative whole UGX and payment terms are length-bounded. Full limit/overdue policy enforcement remains milestone 6.3.

The four old client/institution/supplier credit ledgers and `supplier_payables` have no remaining application or operational-script writers in this integration baseline; they are now read-only historical registers. The active supplier pane uses existing invoice/GRN/management-expense contracts and is preserved. Legacy receivable-to-bank posting also independently checks the source debt's branch; the new raw-batch denial proves bank, debt and movement all roll back. New V2 collections remain disabled pending 6.2.

The audit additionally found a transformer defect: a parameter named `write` could rename permission-method tokens such as `allow write`. Permission lists are now excluded from identifier substitution, with a regression test covering every Firestore permission method. Frequency-weighted alpha-renaming gives shortest symbols to the most-used internal names; it adds no expressions, authorization helpers or call depth.

The filename experiment at 8541d49 returned 503 for canonical and unique names alike, so filename metadata is not established as the root cause. Validation now separates source proof from deletion ownership: an exact immutable canonical source may be referenced read-only by the run's own unique unbound probe, but is retained if its ownership fingerprint is unavailable or differs. Source name/bytes, project, recent metadata and exact probe-to-ruleset relationship still must match. Only a proven run-owned source can be deleted. No HTTP error, control result or source-size reduction substitutes for the actual release-size gate.

Scoped JSON assessment: `docs/PHASE6_RULES_AUTHORITY_AUDIT.json`. Authenticated fixture: `scripts/phase6-authority-audit-emulator.mjs` (59 cases, including positive custom/secondary-role and Marketing controls). CI runs in enforcement mode and records exact-head evidence separately from the 19 recognition scenarios. These tests do not claim a full application-wide audit, live tenant acceptance or Phase 6 completion.

The final authority sweep reproduced collection by an inactive Finance profile using the existing settlement service. Credit reading and legacy settlement now independently require an active staff record. The shared active-profile predicate rejects contradictory inactive/status flags and preserves valid older profiles with only an active boolean or only an active status. These four compatibility cases are included in 59 auditor probes; inactive-Finance settlement has a separate financial denial control.

The broad financial-reversal match is replaced with three explicit collection paths invoking the same reversal validator, removing unnecessary whole-database overlap. A diagnostic also runs the unchanged actual-release verifier on minimal deny-all source after candidate failure, distinguishing basic release-service availability from application-graph complexity. Neither diagnostic can override the mandatory candidate result.

The local execution workspace became unavailable before this final increment could be validated locally. This increment is therefore validated through exact-head CI; no local success is claimed for it. Previous committed repairs passed 777 local unit tests, 55 authenticated auditor cases, 19 recognition cases and financial/inventory regressions.

The first CI run of the final active-state increment identified an old source-shape test expecting repeated uncached staff reads. That test now checks the canonical cached staff path, existence guard and stricter active/status predicate. Authenticated negative and positive controls are unchanged.

The minimal 145-byte control in run 40516423697 successfully completed actual unbound-release validation, while the application source and exact Phase 5 control still failed on HTTP 503. The API, credential and temporary-release mechanism are therefore operational for small input; failure is input-dependent. An internal compiler deadline/complexity limit remains an inference, not an established vendor root cause or proof of executable size.

A match-scoped native-map factoring candidate reduces the generated application source from 138,385 to 133,498 bytes. Global authority helpers and scopes shadowing request/resource are excluded; lookups remain at their existing lazy evaluation sites. The prior unsafe broad helper candidate is not reused unchanged. New structural regressions and all authenticated financial/inventory checks must pass before this candidate can be accepted; source size cannot substitute for actual compiled-release validation.

The initial match-scoped factoring candidate at ae403683 passed credit/auditor and payroll checks but exceeded Firestore's 1,000-expression evaluation budget in Operational Inventory. This is a genuine regression and that candidate is not accepted. The next candidate inlines the existing primary/secondary role predicate in isProcurement, isInventoryOperator and isStockOperator to remove duplicate helper overhead; all role lists, authentication guards, custom-module permissions and admin fallbacks are preserved. If exact-head Operational Inventory still fails, match-local factoring will be withdrawn. No compiler or milestone acceptance is claimed in advance.
