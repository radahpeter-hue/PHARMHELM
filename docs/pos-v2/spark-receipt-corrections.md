# Immediate receipt corrections on Firebase Spark

The POS V2 receipt editor now saves a correction in one client Firestore transaction. It does not require Cloud Functions or a Blaze upgrade, and it does not wait for a scheduled revision worker.

The transaction restores the original historical batch allocations, runs the existing canonical checkout with fresh stock and operator checks, compensates existing payment/credit/welfare/consumption postings, posts the replacement, supersedes the original outbox, and appends immutable revision and audit evidence. A failed transaction writes nothing. An exact retry recovers the committed result; a different correction is rejected. Workers check the current sale and their lease before posting.

Add Service uses the existing tenant's billable_services catalogue. Quantity and price edits synchronize the canonical item fields. Confirmation reserves the print window before saving, then prints the corrected receipt. The original sale stays available as evidence. Reporting uses the replacement once, in the original business period, with the actual edit time recorded separately. The revision ledger watches its first 100 records and loads older pages on demand.

## Validation

- `npm test`: 528 passing tests.
- `npm run typecheck` and `npm run build`.
- `npm audit --omit=dev --audit-level=low`: zero production vulnerabilities.
- `node scripts/run-pos-v2-spark-emulator.mjs`: the actual repository and production rules, using a demo project and a checksummed local Firestore emulator. Covers cash increases/decreases, catalogue services, posted/unposted credit and welfare, multiple batches, six products, simultaneous saves, exact replay, conflicting intent, insufficient stock, settled credit, stale posting workers, fresh operator/reference validation, and rollback when required financial/audit writes are omitted. Also runs the existing revision RBAC suite.
- PR CI repeats validation and submits the candidate rules to the hosted Firebase compiler. This compiler check does not deploy rules.

## Release and existing pending requests

The deployment workflow deploys rules and creates only the two required revision indexes directly through Firestore and verifies both revision-ledger indexes are READY in the named database before releasing Hosting. Keep the existing outbox worker available for ordinary sales; atomic corrections arrive already processed. The old revision lifecycle remains for previously submitted requests.

An existing scheduled revision request deliberately blocks a new atomic correction. Inspect its request, original/replacement sales, outbox leases, stock movements and financial reversals before recovering it. Do not delete the request or replay stock restoration to bypass the block. This change does not recover the live Masaka receipt BR-3QLNF-2026-420818 or alter production records.

The existing 72-hour, tenant/branch and operator restrictions remain. Settled institutional credit, partial historical financial postings and unsupported split-payment changes require reconciliation. The existing ordinary POS stock permissions are retained; this repair does not redesign inventory authorization. Very large receipts remain subject to Firestore transaction and security-rule limits.
