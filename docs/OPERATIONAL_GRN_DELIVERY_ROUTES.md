# Operational GRN delivery routes

New branch Operational supplier GRNs default to **Direct to ordering branch**.
The receiving officer can instead select **Via HQ Operational Store** before
posting. HQ buffer orders always use HQ. The first GRN locks the order route;
partial receipts and later supplier invoices must use that same route. Existing
route-less GRNs, orders and transfers retain their historical HQ treatment.
There is no migration or stock rewrite.

| Stage | Direct to branch | Via HQ |
| --- | --- | --- |
| Supplier GRN | Records invoiced quantities as supplier delivery preparation, with destination `SUPPLIER_TRANSIT`. No stock increase. | Posts HQ Operational receipt and stock increase. |
| Dispatch | Creates/resumes the same deterministic Operational transfer and lines, without an HQ movement or deduction. | Existing HQ outbound movement and deduction. |
| Branch receipt | Adds accepted units only to the requesting branch; queried units stay excluded. | Same branch receipt workflow. |

Direct GRNs are supplier delivery preparation records, not evidence that the
branch has accepted goods. Branch receipt remains the physical acceptance step.
Supplier invoices remain unpaid, using the existing cash-draft or credit-liability
posting. Consumable/fixed-asset Finance event classification is unchanged, with
the event destination tied to its source GRN. Finance settlement PR #73 is excluded.

Direct transfers identify their source as `SUPPLIER_TRANSIT`, not an HQ item.
`dispatchMovementId` is empty because no inventory was deducted at dispatch. The
immutable posted GRN, source order line, master identity, destination location,
exact received units and value authorize the transfer line instead. Branch receipt
continues to use its deterministic movement key and rejects duplicate posting.
An HQ location item is not required for a direct delivery.

Firestore enforces the route lock, order/destination/GRN linkage, class, tenant,
quantities and authenticated Procurement role. HQ buffer direct routing and route
changes after posting fail closed. The actual mixed-role authenticated emulator
test covers partial direct GRNs, 12-unit packs, dispatch, accepted/queried receipt,
retries, denied route changes and invalid lines. Existing VIA_HQ, return, fixed
asset, feature gate and class-isolation regressions remain enabled.

UI verification runs the actual GRN modal with capture-only services at 360px,
390px and 1280px, under inherited white text. It checks route selection, mobile
quantity editing, posting payload, route locks, HQ default and reachable footer.
The desktop Dispatch Register also explicitly restores dark foreground values.

Release only after Foundation CI, hosted rules compilation and Operational UI
checks succeed on the final SHA. Verify the exact deployed named-database rules
fingerprint before live acceptance. Test a new synthetic direct order in Martin
Pharma (`mp.pharmhelm.com`), Masaka; compare HQ/branch balances before GRN, after
GRN, after dispatch and after branch receipt. Never recreate ORD-2026-15022's GRN
or transfer, reprocess Sellable ORD-2026-46427, or settle AVN161026001234.
