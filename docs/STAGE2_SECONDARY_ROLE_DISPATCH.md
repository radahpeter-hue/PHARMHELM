# Stage 2: secondary-role Operational dispatch recovery

## Diagnosis and scope

Base: main `59f737d` (PRs #74, #75 and #76 merged).

The frontend merges system permissions for primary and secondary roles. It maps
Procurement Personnel to Procurement Officer. Firestore's `isProcurement()` also
explicitly recognizes Procurement Personnel in `secondaryRoles` on the authoritative
`staff/{auth.uid}` record. Neither a missing alias nor missing token claims explains
this failure. Custom role-realm handling differs between frontend and rules, but is
not needed for this built-in role combination and is outside this fix.

Using the real dispatch service, an authenticated IT Head with Procurement Personnel
secondary reproduces the interrupted external-supplier transfer: a dispatching
header, zero of one lines, and zero dispatch movements. On the original rules,
the transaction creating the deterministic `operational_transfer_lines` document
fails with `PERMISSION_DENIED` at the create validator (original rule line 1793):
`the maximum of 1000 expressions to evaluate has been reached`.
Primary-only Procurement Head passed the earlier regression. Evaluating secondary
membership adds work; repeated helper/path evaluations in the prepared-line
validator push this legitimate transaction past the expression budget.

The fix binds transfer, source item, destination item, master and optional source
order line once in `validPreparedOperationalTransferLine`. Every existing boolean
predicate remains. The optional order-line binding preserves HQ_DIRECT transfers
that have no source order line. No role grants, UI, stock service, GRN processing,
finance logic or feature gate changes are included.

## Validation

The existing CI Operational Inventory emulator job already invokes the updated
`scripts/operational-inventory-rules-emulator.mjs`; no new job is required.
The regression authenticates with IT Head token claims only, and resolves
Procurement Personnel through the staff secondary roles. It checks:

* The actual interrupted header starts with zero transfer lines and movements.
* IT-only staff cannot dispatch, even with a Procurement Head token claim.
* The actual service resumes the same deterministic header, finalizes the order,
  creates one dispatched line and one outbound movement, and deducts stock once.
* A second invocation is idempotent, retaining one movement and the same balance.
* Invalid quantity, tenant, destination, master, class and missing order line fail.
* Existing registration, HQ direct distribution, GRN, return, feature-gate and
  branch/class isolation tests continue to execute.

Local validation: 692 unit tests passed; TypeScript and production build passed;
the complete Operational Inventory emulator script passed. The baseline reproduction
failed before the rules refactor. CI results must be verified on the final PR SHA.

## Controlled release and live acceptance

1. Require successful final-SHA Foundation CI, including all emulator suites and
   hosted rules compilation. Review only this diff; keep finance draft PR #73 out.
2. Merge only after release authorization. Main automatically runs Firebase deploy.
   Verify that workflow's exact named-database rules fingerprint check succeeds for
   `gen-lang-client-0911422817`, database
   `ai-studio-f7d8654b-e089-425a-a506-38159afe1e75`. Do not bypass that check.
3. On Martin Pharma / Masaka, inspect ORD-2026-15022 before any dispatch action.
   Confirm its existing EXTERNAL_SUPPLIER header and reconcile current line/movement
   counts and HQ balance. The earlier live observation was dispatching, 0/1 lines,
   zero dispatch movements; it has not been re-inspected or modified by this patch.
4. Use Inspect Transfer, then Resume Staged Transfer for that exact existing transfer
   under IT Head primary and Procurement Personnel secondary. Do not create a new
   transfer or GRN. Stop if inspection reports conflicting quantities or linkages.
5. Verify one completed line, one outbound movement, one HQ deduction, dispatched
   header/order and an available Masaka Operational receipt. Dispatch alone must
   not credit branch stock before receipt. Confirm the smartphone cards and controls
   remain readable and usable; no UI change is included in this patch.
6. Never reprocess Sellable ORD-2026-46427. Invoice AVN161026001234, UGX 38,000,
   stays unpaid; payment/settlement belongs to draft PR #73.

If deployment verification fails, stop before live retry. If retry fails, inspect
the same transfer again and retain all evidence; do not delete stock movements,
recreate the GRN, or manufacture a replacement transfer. Reverting this rules-only
change restores the previous authorization behavior; it cannot undo a completed
business dispatch. Any business reversal requires its own supported workflow.
