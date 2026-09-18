# POS V2 Batch 6 production validation

## Release boundary

Merging Batch 6 does not activate POS V2. The safe deployed state remains:

- tenant feature absent or disabled;
- tenant checkout engine `legacy`;
- every branch checkout engine `legacy`.

The activation workflow changes configuration only when a production operator
selects `activate`, supplies one exact tenant ID and branch ID, provides a
reason, and explicitly enables `apply`. Its default path is read-only.

Batch 6 does not add V2 sale reversal or revision. A pilot may proceed only at
a branch where staff accept that a committed V2 sale cannot be voided or edited.
Broad rollout remains blocked until a durable compensating-event design is
implemented and validated.

## What Batch 6 closes

| Risk | Control |
| --- | --- |
| Browser refresh after an ambiguous commit | A technical pending-attempt marker survives refresh, checkout is blocked, and the canonical attempt/sale/payment/outbox chain is recovered before another sale can start. |
| Client mutation of committed V2 sales | Firestore client rules reject updates and deletes when `engineVersion` is `2`. |
| Ad hoc configuration edits | A dry-run-first, exact-tenant/exact-branch workflow validates ownership and active status, writes a production audit record, and verifies readback. |
| Silent downstream exhaustion | The Batch 4 worker marks terminal retries for manual review and stops automatically retrying them. |
| False-green reconciliation | Reconciliation reports global and per-consumer state, expired leases, manual-review events, and exits nonzero while any event still needs work. |

The browser marker contains only the attempt, tenant, branch, operator and
timestamp identifiers. It contains no patient, basket, price or payment data.
The marker does not expire silently: it remains until the server proves that no
attempt exists or the completed canonical chain is recovered. An unreadable
marker blocks checkout for support intervention.

## Required preflight after deployment

Do not activate from the same change that deploys Batch 6. After deployment,
complete each gate against the named production database and retain the GitHub
Actions run URLs in the change record.

1. Confirm the normal CI test, type-check and build jobs are green.
2. Run **POS V2 Batch 4 Durable Posting** in `process` mode.
3. Run it again in `reconcile` mode.
4. Require an exit code of zero and verify:
   - `inconsistent = 0`;
   - `requiresProcessing = 0`;
   - `manualReview = 0`;
   - `expiredLeases = 0`;
   - `problemEvents` is empty.
5. Confirm the scheduled Batch 4 job has completed successfully at least twice
   after the deployment. A manual run proves credentials and code; it does not
   prove the schedule is firing.
6. Confirm the pilot tenant, branch, operator, low-value scenario and on-call
   owner are recorded and approved.

Any nonzero reconciliation exit is a stop condition. Resolve the listed event
IDs before activation; do not clear flags or rewrite canonical records merely
to make the report green.

## Dry run and activation

Open **POS V2 Batch 6 Controlled Activation** with:

| Input | Dry run | Apply |
| --- | --- | --- |
| `operation` | `activate` | `activate` |
| `tenant_id` | Exact approved tenant document ID | Same ID |
| `branch_id` | Exact approved active branch document ID | Same ID |
| `reason` | Pilot/change reference | Required pilot/change reference |
| `apply` | Off | On |

The dry-run output must show only these desired values:

- tenant `features.posCheckoutV2Enabled = true`;
- tenant `posCheckoutEngine = legacy`;
- selected branch `posCheckoutEngine = v2`.

It must not identify any other branch or propose writes to sales, payments,
inventory, checkout attempts or outbox records. After a second-person review,
run the apply path and retain its audit ID and readback output.

## Pilot validation

Start with one low-value cash transaction. Record the attempt ID and verify one
and only one of each canonical record:

- completed checkout attempt;
- sale with `engineVersion = 2`;
- linked canonical payment;
- linked `POS_SALE_COMMITTED` outbox event;
- expected inventory movement and downstream consumer results.

Then verify receipt display/reprint and the relevant Finance visibility. Retry
the same submission once to prove it replays the original sale without a
second stock deduction or downstream posting.

For the browser-recovery check, use a controlled test only: preserve a pending
attempt marker across refresh, return to Sales, and confirm the page either
recovers the completed receipt or confirms no attempt exists before permitting
a new checkout. Never manufacture an ambiguous state against a live customer
transaction.

Only after the cash scenario is clean should the approved team run the Batch 5
matrix for mobile money, multi-tier/FEFO, service-only or mixed, quotation,
institutional credit and staff welfare payments.

## Immediate rollback

Use **POS V2 Batch 6 Controlled Activation** with `operation = rollback`, the
same tenant and branch IDs, an incident/change reason, and `apply` enabled. The
workflow changes only the selected branch engine to `legacy` and verifies the
readback.

Rollback controls new attempts only. An attempt already pinned to V2 must be
retried or recovered using its original attempt ID. Never route it through V1,
delete it, or edit the committed sale/payment/outbox chain.

After rollback:

1. run Batch 4 `process`;
2. run Batch 4 `reconcile` and require a zero exit;
3. preserve affected IDs and logs;
4. keep the branch on legacy until the incident is resolved and a new approval
   is recorded.

For a tenant-wide emergency stop, an authorized administrator may separately
set `features.posCheckoutV2Enabled = false`. That broader change is deliberately
outside the branch-scoped workflow and needs its own change approval.

## Exit criteria

The pilot is complete only when the activation and rollback paths have approved
evidence, the live scenarios reconcile end to end, refresh recovery has been
observed, scheduled posting is proven, and no event is pending manual review.
These criteria authorize only the named pilot branch. They do not remove the
durable-reversal blocker for broad rollout.
