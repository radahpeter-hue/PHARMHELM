# Finance V2 Firestore security contract — implementation gate

Status: DESIGN ONLY. Do not activate new finance_v2_* writes or register accounts until these rules are implemented, tested with authenticated emulator identities, and approved.

## Existing rule compatibility
The current `finance_payment_accounts` create rule only accepts `management_petty_cash` and `management_bank`, each with controlVersion=1. Existing `validManagementAccountUpdate` and linked `petty_cash_ledger`/`banking_records` protections must continue unchanged. Do not relax them with a broad `allow update`. No current client-side Finance V2 planner or writer can override deployed rules.

## V2 account creation
Allow create only if:
- authenticated finance role and matching tenant membership (no cross-tenant admin bypass for cash posting);
- document ID exactly `tenantId_accountId`;
- kind in the five enumerated V2 types, currency UGX, initialized true, controlVersion=2, active true;
- accountId does not equal either legacy reserved ID;
- openingBalanceUGX and balanceUGX are identical nonnegative whole UGX;
- lastPostingId null, registeredBy equals request.auth.uid;
- reconciliationReference is nonempty with length >=5;
- BRANCH_CASH_SALES carries an existing branchId belonging to the tenant and an authorised branch assignment; other branch accounts must also match the tenant's branch;
- new registration is gated on a reviewed reconciled-opening-balance attestation before approval.

**Important:** Client-supplied opening-balance evidence is not independent validation. Require approved/reconciled Finance evidence before accepting positive opening balance. Until then default to zero or deny registration.

## V2 transfers
A posted transfer requires a deterministic transfer ID and payload fingerprint; matching replay cannot write balances again; conflicting replay fails. For all linked account updates, security rules must assert:
- tenant, account and branch ownership, actor permission, current account status and UGX currency;
- exact positive or negative balance delta derived from linked movement(s), principal and separate charge;
- all counterpart movements, charge event and transfer record existAfter in the same atomic commit;
- source can pay principal plus charge and any independent charge account has sufficient funds;
- only permitted fields mutate (balanceUGX, lastPostingId, updatedAt and audited sequence);
- no direct client write to ledger without linked accepted transfer and no deletion.

## Tests required before enablement
1. Authorized transfer: source balance decreases by full principal plus payer's fee, destination gets full principal.
2. Different fee payer; zero fee; insufficient fee funding.
3. Duplicate submission same payload; conflicting payload; simultaneous competing transfers.
4. Cross-tenant account mutation and branch-inappropriate mutation denied.
5. Unregistered, inactive, negative, malformed and mismatched accounts denied.
6. Forged account delta, orphan ledger, orphan charge, fake opening attestation and direct update denied.
7. Existing supplier settlement, legacy management account and POS posting regression unchanged.
8. Firestore compiled size and authenticated emulator coverage pass, before deployment.

## Not yet done
No V2 account rules, posting rules, UI, live migration, production reconciliation or emulator certification have been performed. The staged posting writer is disabled by default.
