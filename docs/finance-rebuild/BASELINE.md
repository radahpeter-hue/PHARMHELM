# Finance rebuild Levels 1–2 baseline

Verified 2026-10-28. Repository: radahpeter-hue/PHARMHELM.

- Source branch: main.
- Exact base: `4f6ef5706b22b6e8addf6e352568f2bf775e9f62`.
- Latest production deployment: successful Deploy to Firebase run [39576637436](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39576637436), same SHA; Hosting step successful. This is deployment-history evidence, not an independent live asset fingerprint.
- Latest Finance baseline already incorporated: PR #82 (`6c1c872134dcb7f7235adb8ccbeb3dcdc96a6fb4`, supplier Cash/Bank settlement/shared Management balance), followed by release fix PR #83 (`f3c83a12c9761b1d35ef7881ba810b6c0dc1c9e2`). Both are ancestors of main and the successful deployment.
- Selected because current main and latest successful production deployment agree. No experimental branch is used.
- Working branch: `feature/finance-rebuild-levels-1-2`.

## Open Finance work deliberately excluded

| PR | Branch | Subject |
|---|---|---|
| 85 | release/systemwide-finance | supplier settlement release |
| 86 | feature/finance-v2-phase1-contracts | V2 contracts |
| 87 | feature/finance-v2-phase2-eod | shift EOD |
| 88 | feature/finance-v2-phase3-cash-banking | V2 cash/banking |
| 89 | feature/phase4-grn-finance-integrity-20261021 | GRN validation |
| 90 | feature/finance-v2-phase5-hr-advance-validation-20261021 | payroll/welfare |
| 91 | feature/finance-v2-phase6-credit-20261026 | credit/receivables |
| 92 | fix/phase6-firestore-rules-certification | rules certification |

Other Finance-named branches: `fix/branch-finance-credit-display`, `fix/finance-credit-status-branch-name`, `fix/stage2-safe-finance-settlement`; no code imported from these branches.

## Initial inventory (before modifications)

| Changes | Stable-code finding |
|---|---|
| 001–002 | Old names still in UI/export labels; changes outstanding. |
| 003 | Salaries manually selectable; removal outstanding. Historical records must stay. |
| 004 | Allowances absent from Branch Expense form; addition outstanding. |
| 005 | Recipient state exists but no field, persistence or record display; outstanding. |
| 006–009 | Branch petty-cash histories have no date controls/default; outstanding. Existing subscriptions retrieve full history. |
| 010 | Ordinary employees already cannot see Admin Welfare; role-guarded management tabs exist. Verify/preserve. |
| 011 | P&L supports arbitrary date range but no named period presets. |
| 012–013 | Management profitability is consolidated and tenant scoped; no explicit Branch/Consolidated selector. Must preserve formulas and permissions. |
| 014–018 | Authoritative HR register is `staff`. No branch-expense recipient selector or validation exists. |
| 019–020 | EOD already checks total variance for reason, but raw floating-point differences and offsetting channel differences need examination. |
| 021–022 | EOD uses raw subtraction; Management inbox can format tiny negative differences as -0. Need normalization at existing monetary precision. |

## Scope boundaries

No Phase 6 imports, Stage B, Credit Receivables V2, migrations, ledger redesign or rules compaction. `firestore.rules` must remain byte-identical. Existing broad application-validation architecture retained; no claim of new server-enforced allowance validation. Preview Hosting shares the existing backend and permissions; deployment itself must not write tenant records or deploy rules/indexes. Owner must use authorised test accounts and controlled test records.

A paginated Finance-branch inventory also identifies `ops/stage2-finance-activation`, `feature/stage2-central-grn-finance-20261016`, and `release/systemwide-finance`. These remain excluded; no branch is treated as a production baseline merely because it exists.
