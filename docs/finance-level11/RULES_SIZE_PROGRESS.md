# Level 11 rules-size reduction record

PR: https://github.com/radahpeter-hue/PHARMHELM/pull/127

All figures labelled local are stripped emulator-compiler AST estimates, not Firebase hosted certification. The hosted executable must be smaller than 256,000 bytes. A candidate is complete only when its exact hosted release check and all required functional CI checks pass.

| Candidate | Local estimate (bytes) | Reduction from preceding candidate | Hosted verification |
| --- | ---: | ---: | --- |
| Starting head 2281047 | 266,092 | n/a | Not verified; HTTP 503 |
| Targeted pass 1, 170c8f3 | 263,498 | 2,594 | Functional CIs passed; hosted size verification HTTP 503 |
| Targeted pass 2, 2f3dbc2 | 263,027 | 471 | Payroll, POS, Finance Level 4 and preview passed; both hosted gates failed with HTTP 503 |
| Targeted pass 3, a0674ea, equality pairs | 262,870 | 157 | Local acceptance passed; hosted verification pending |
| Targeted pass 4, 8453c9e, function bindings | 260,329 | 2,541 | Local tests and POS/payroll/Finance Level 4/preview CI passed; hosted gates HTTP 503 |
| Targeted pass 5, fb6a8e4, shared value guards | 256,309 | 4,020 | Local tests passed; hosted verification pending |
| Targeted pass 6, global/local name allocation | 255,972 | 337 | All local tests passed; hosted verification pending |
| Scalar-choice experiment, rejected | 255,348 | 4,981 | Not pushed; inventory runtime evaluation error |
| Path-sharing experiment, rejected | 261,912 | 1,586 | Not submitted; receivable test failed |

Pass 1 preserves scalar conditional branches and packs required equalities only in positive authorization contexts. It changes the release compiler, not the application's roles, tenant checks, financial invariants or data model. The local suite passed 924 unit tests, 176 original/released authorization comparisons, 385 comparison-context cases, and the complete inventory, portfolio transfer, payroll, supplier-payment and receivable emulator scripts.

The path-sharing experiment reuses document-path construction for staff, settings and branches outside the protected busy inventory/Treasury call graph. Inventory, transfers, payroll and supplier tests passed, but the receivable test exceeded the evaluation budget. The experiment is rejected and is not the candidate currently being checked by CI.

No merge, production rules activation, Hosting deployment or live financial operation has been performed.

Pass 2 omits field accessor helpers where their estimated declaration/call overhead exceeds the repeated field text saving. All six local authenticated integration scripts passed, including receivable settlement. Its default generated rules match the tested artifact exactly. The hosted failure diagnostics additionally try indexed field access without changing the release candidate or weakening the blocking gate.

Pass 3 extends the existing positive-context equality packing to conjunctions containing exactly two comparisons. Local validation: 925 unit tests, 176 release authorization comparisons, 385 malformed/missing-field comparison cases, and inventory, transfers, payroll (13 groups including 130 employees), supplier and receivable acceptance scripts all passed. This is a local estimate, not hosted certification.

Pass 4 reuses short parameter/let names within sibling functions. Function names, captured match bindings and literal path names remain reserved. No expression, call or data access is added. The exact generated candidate passed 927 unit tests, 176 release comparisons, 385 vector cases and all five authenticated integration scripts (inventory, transfers, payroll, supplier and receivable settlement). Initial prototypes that changed a literal staff path were rejected and were not committed.

Pass 5 shares 78 adjacent integer/number/string type-and-bound checks in pure helpers. Bounds, lazy guard position, type checks and all financial invariants remain. Arithmetic suffixes, literals and comments are excluded. The exact generated candidate passed 928 unit tests, TypeScript, 176 release authorization comparisons, 512 type/range authorization comparisons (including negated conditions and malformed values), and the five integration scripts. Production build is checked separately. Scalar-choice experiments, including conservative/protected variants, were rejected for runtime errors and are not in the branch.

Pass 6 allocates short names to shared functions/captured match bindings before local function bindings, reserving eight letters for the latter. It changes identifiers only. The exact candidate passed 928 unit tests, 176 release comparisons, 512 value-guard comparisons and all five integration scripts. This 28-byte estimated margin is not hosted proof.
