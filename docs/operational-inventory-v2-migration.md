# Operational Inventory V2 historical migration

The migration script is tenant-scoped and preview-only unless `--apply` is supplied. It reads the tenant's Operational items, masters, stock movements, orders, order lines, GRNs, usage and Finance expense references. It does not inspect or modify other tenants' records.

## Preview

Use an authorised Google OAuth token with Firestore data access. Set the accountable operator ID for any apply run. Keep tokens out of source control and logs.

```sh
GOOGLE_OAUTH_ACCESS_TOKEN="$TOKEN" node scripts/migrate-operational-inventory-v2.mjs --tenant=TENANT_ID
```

The JSON preview lists proposed class/subtype/master backfills, opening movements, audit documents, missing HQ Operational locations, historical Finance items needing review, and ambiguous records.

## Apply

Review and retain the preview first. Apply only when the report contains no ambiguous records and Operational Inventory is enabled for that tenant in System Settings.

```sh
GOOGLE_OAUTH_ACCESS_TOKEN="$TOKEN" \
OPERATIONAL_MIGRATION_ACTOR="ACCOUNTABLE_OPERATOR_UID" \
node scripts/migrate-operational-inventory-v2.mjs --tenant=TENANT_ID --apply
```

Apply uses Firestore update-time preconditions and deterministic IDs. Each master creation, item/opening-movement backfill, order/line backfill, and GRN backfill commits with its immutable migration audit record. A rerun skips existing audit records and converged item state. The migration requires privileged Firestore IAM access because historical stock must be backfilled without weakening normal client security rules.

## Safety behavior

- Explicit Sellable classifications are never changed.
- Mixed-class or contradictory orders, item identities, GRNs, and unreconciled movement histories block the entire apply run.
- Historical Operational GRNs are tagged for Finance review. The migration never creates backdated OPEX or fixed-asset Finance events because legacy usage may already have been expensed.
- Existing operational usage-linked Finance entries are retained and reported for reconciliation.
- Branch-only masters without a valid HQ Operational location are reported. The script does not invent HQ balances.
- Positive legacy stock with no movement history receives one deterministic opening adjustment, linked to its location item and migration audit record.
- Run against a non-production tenant first, then inspect the preview and post-migration stock reconciliation before considering production use.

Firestore rule behavior for opening balance writes still requires Emulator Suite verification before release. The repository's normal unit, typecheck, and build results do not replace that gate.
