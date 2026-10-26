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
