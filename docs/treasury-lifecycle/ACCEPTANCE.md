# Treasury lifecycle repair

Base: main `848a754db9eebc2a9b09a29c1ef13871d8b5f929` (deployed Level 4).
Branch: `fix/treasury-portfolio-lifecycle`.

## Behaviour

The CEO can deactivate a custom portfolio or registered individual bank account after its authoritative reconciled balance reaches exactly zero, even if it previously held money. Reactivation preserves the original identity, opening reconciliation and every ledger entry. Nonzero balances still block closure. Rules independently reject postings and opening reconciliation to inactive or removed custom identities, including a same-batch attempt to close and deposit.

An inactive, never-reconciled, single-account custom portfolio or bank account has a Delete unused account action with a required reason. Deletion removes it from the directory and retains its immutable registry audit tombstone. It cannot be recreated, reactivated or reconciled. This is directory deletion, not physical erasure of the registry document. Reconciled accounts, even if opened at zero or subsequently emptied, cannot be deleted. Existing payment accounts remain non-deletable and no financial history is erased. Built-in system portfolios retain their existing lifecycle restrictions. Parent identities supporting child accounts remain protected from deletion, since persisted generic child-account support is not currently enabled.

No Level 5 transfer implementation, migration, production financial write, merge or deployment is included.

## Validation

- TypeScript, production build and 830 unit tests pass locally.
- Authenticated Firestore emulator: zero-balance closure after real ledger movement, reactivation, retained opening and original ledgers, nonzero rejection, inactive posting/funding rejection, directory deletion, repeat/forged deletion, finance-role and wrong-tenant denials, and atomic close/deposit failure.
- Treasury browser fixture includes 360/1440 pixel lifecycle controls, used-account deletion exclusion, unused deletion, nonzero failure and rapid double-click lock.
- Required PR checks: Finance Level 4 (including EOD regression and browser fixtures), Management Cash settlement, POS Foundation and actual hosted compiled Rules size. No production Rules activation is part of validation.

## Owner checks after an approved release

1. CEO: open a used account with zero balance, enter a reason and deactivate. Confirm the ledger is still visible. Reactivate and verify the same identity and ledger.
2. Try deactivating an account with a positive balance. Expect rejection and no change.
3. Create an unused test account, deactivate it, enter a deletion reason and delete it. Confirm it disappears from the directory. Reusing its bank identity must be rejected.
4. Confirm used/reconciled accounts have no Delete action and ordinary Finance users cannot perform lifecycle actions.

Production status: NOT MERGED, NOT DEPLOYED. Owner approval is required for release.
