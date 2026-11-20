# Level 11 rules-size reduction record

PR: https://github.com/radahpeter-hue/PHARMHELM/pull/127

All figures labelled local are stripped emulator-compiler AST estimates, not Firebase hosted certification. The hosted executable must be smaller than 256,000 bytes. A candidate is complete only when its exact hosted release check and all required functional CI checks pass.

| Candidate | Local estimate (bytes) | Reduction from preceding candidate | Hosted verification |
| --- | ---: | ---: | --- |
| Starting head 2281047 | 266,092 | n/a | Not verified; HTTP 503 |
| Targeted pass 1, 170c8f3 | 263,498 | 2,594 | Functional CIs passed; hosted size verification HTTP 503 |
| Targeted pass 2 | 263,027 | 471 | Awaiting CI |
| Path-sharing experiment, rejected | 261,912 | 1,586 | Not submitted; receivable test failed |

Pass 1 preserves scalar conditional branches and packs required equalities only in positive authorization contexts. It changes the release compiler, not the application's roles, tenant checks, financial invariants or data model. The local suite passed 924 unit tests, 176 original/released authorization comparisons, 385 comparison-context cases, and the complete inventory, portfolio transfer, payroll, supplier-payment and receivable emulator scripts.

The path-sharing experiment reuses document-path construction for staff, settings and branches outside the protected busy inventory/Treasury call graph. Inventory, transfers, payroll and supplier tests passed, but the receivable test exceeded the evaluation budget. The experiment is rejected and is not the candidate currently being checked by CI.

No merge, production rules activation, Hosting deployment or live financial operation has been performed.

Pass 2 omits field accessor helpers where their estimated declaration/call overhead exceeds the repeated field text saving. All six local authenticated integration scripts passed, including receivable settlement. Its default generated rules match the tested artifact exactly. The hosted failure diagnostics additionally try indexed field access without changing the release candidate or weakening the blocking gate.
