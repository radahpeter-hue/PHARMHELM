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

## Tenant-wide identity catalogue repair

The app now uses immutable identity claims and a protected tenant readiness marker.
The rules derive the claim ID from the normalized name, category, type, units per
pack and issue unit. Two concurrent registrations must use the same claim and
cannot create separate masters. Existing master IDs and location IDs remain intact.
Registration fails closed until a reviewed legacy backfill sets the marker. Branch
clients never need a tenant-wide inventory query to check legacy identities.

Preview (no writes):

```sh
node --import tsx scripts/backfill-operational-identities.mjs --slug=mp --actor=reviewer
```

The **Operational Identity Preview** Actions workflow runs the same read-only
preview with the existing authorized service account. Review the artifact for
conflicts before proceeding. Duplicate legacy identities require a reviewed JSON
mapping of location IDs to the retained master ID, supplied with `--links=path.json`.
The planner does not merge existing masters or change explicit Sellable records.

For a tenant that has a conflict-free reviewed preview:

1. Deploy the rules that enforce readiness and immutable identity fields.
2. Disable Operational Inventory in System Settings to freeze Operational writes.
3. Run the same command with `--apply`, an identified operator and any reviewed links.
4. Verify the masters, location links, claims and immutable migration audit.
5. Re-enable the feature and register the shared catalogue identities at HQ with
   zero starting stock using **Register at HQ**.
6. Test branch ordering, HQ buffer ordering, GRN finalization, dispatch and receipt.

Apply uses one atomic commit, version preconditions for every source and settings,
and a create-only readiness marker. It refuses more than 450 operations. It updates
identity metadata only; quantities, historical IDs, movements and finance records
are preserved. A completed backfill has no remaining identity writes on preview.
The readiness marker is writable only by an authorized server/IAM process.
