# Bounded Phase 6 compiler isolation

Baseline: 926467483204678604c53d4033276d29efb9ddf4. Phase 6.1 remains blocked; 6.2 is held. This investigation does not repeat unchanged application-size retries manually. It tests fail-closed subsets to distinguish aggregate compiler load from specific permission families.

The lexer finds 493 actual permission statements, groups nested matches with their owning collection path and ignores strings/comments. Two disjoint halves cover every original permission exactly once. Additional controls retain credit/POS/CRM, finance/payroll, generic fallback or no permissions. Every excluded statement becomes `allow read, write: if false;`; helper bodies are retained and the existing release compactor generates each output. These inputs can only remove permissions from the original source. They are not deployable application candidates.

The diagnostic workflow measures six inputs sequentially, using the unchanged actual unbound-release verifier with separate numeric operation suffixes. It writes exact commit/source hashes, retained groups and permission counts, elapsed times, exit status and full non-secret logs. The workflow's completion means observations were collected; it never certifies production rules. No Firestore application data, production releases, tenant balances or live collections are written. Existing owned-probe cleanup and candidate-source ownership constraints remain in force. Maximum diagnostic job duration is 30 minutes.

Local validation: 783 unit tests pass, including parser coverage for nested paths, wildcard captures, quoted/commented permissions, exact partition and deny-all replacements. Application rules and release compactor are unchanged. Conclusions require the actual CI observations; none are invented in this record.

Stopping rule: use this isolation evidence for one targeted simplification and actual runtime/compiled-size checks, or produce a reproducible compiler failure and explicit architecture/support decision. Subset success cannot replace whole-application certification.

## Observed hosted results

Run https://github.com/radahpeter-hue/PHARMHELM/actions/runs/40572417323 on da7b8a613201d4034ea479f1c87de0362b678507 completed the six observations. Evidence artifact: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/40572417323/artifacts/12766046032 .

| Input | Retained permissions | Actual release result | Seconds |
|---|---:|---|---:|
| All denied | 0 | Passed | 27.7 |
| First half | 250 | HTTP 503 during source compilation | 54.3 |
| Second half | 243 | HTTP 503 during source compilation | 55.3 |
| Credit/POS/CRM | 60 | Passed | 27.9 |
| Finance/payroll | 82 | Passed | 118.5 |
| Generic fallback | 2 | Passed | 16.5 |

This supports aggregate graph complexity/interactions rather than identifying a single invalid credit rule. It does not establish the vendor root cause, a Spark architectural impossibility or executable fit for the full source.

## One targeted candidate

Generic fallback repeats separate authority/dedicated/finance exclusion wrappers and checks immutable staff/client/institution fields even though all three collections are excluded from fallback writes. The candidate consolidates the exclusion predicate, removes duplicate write-only exclusions and retains only the reachable prescriber identity check. The original membership groups remain lazy; the finance exclusion can be evaluated earlier on the write path. No staff/debtor dedicated guard, role policy, branch check, financial posting relationship or account balance contract changes. A checked-in fixture from 9264674 proves identical read/write exclusion sets, including near-match and unknown collection names. Authenticated inventory and POS tests validate the runtime budget after the evaluation-order change.

Local result: 785 unit tests, TypeScript, 59 authority probes, 19 credit-recognition scenarios, Management settlement/full POS corrections, ten inventory/procurement/identity suites, and Phase 5 authority/advance/reconciliation scripts all pass against generated rules. Phase 5 controlled Martin Pharma/Masaka acceptance passed all 20 financial scenarios. Generated full source is approximately 137,877 bytes, which is only a source measurement. The actual whole-application hosted gate and exact-head CI must still pass before milestone acceptance. If this one targeted candidate fails hosted validation, this bounded pass ends with the reproducible evidence above; do not restart unchanged retries or claim sign-off.

## Diagnostic lifecycle and quota contention

The candidate's first hosted application checks still returned 503 before quota exhaustion. Later requests in run 40574587397 and Management run 40574587491 hit the 72-per-minute quota while the automatic six-input diagnostic also ran. Those quota-affected observations cannot be used to infer compiler complexity. The diagnostic is now pinned to the two investigated snapshot commits for automatic PR runs; future measurements require an explicit workflow_dispatch. This prevents routine financial commits from automatically adding six extra compiler inputs. It does not relax any required release-size check. No further unchanged manual retries or speculative rule variants belong to this bounded pass. Final exact-head CI is recorded in PR #91.
