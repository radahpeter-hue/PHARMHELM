# Bounded Phase 6 compiler isolation

Baseline: 926467483204678604c53d4033276d29efb9ddf4. Phase 6.1 remains blocked; 6.2 is held. This investigation does not repeat unchanged application-size retries manually. It tests fail-closed subsets to distinguish aggregate compiler load from specific permission families.

The lexer finds 493 actual permission statements, groups nested matches with their owning collection path and ignores strings/comments. Two disjoint halves cover every original permission exactly once. Additional controls retain credit/POS/CRM, finance/payroll, generic fallback or no permissions. Every excluded statement becomes `allow read, write: if false;`; helper bodies are retained and the existing release compactor generates each output. These inputs can only remove permissions from the original source. They are not deployable application candidates.

The diagnostic workflow measures six inputs sequentially, using the unchanged actual unbound-release verifier with separate numeric operation suffixes. It writes exact commit/source hashes, retained groups and permission counts, elapsed times, exit status and full non-secret logs. The workflow's completion means observations were collected; it never certifies production rules. No Firestore application data, production releases, tenant balances or live collections are written. Existing owned-probe cleanup and candidate-source ownership constraints remain in force. Maximum diagnostic job duration is 30 minutes.

Local validation: 783 unit tests pass, including parser coverage for nested paths, wildcard captures, quoted/commented permissions, exact partition and deny-all replacements. Application rules and release compactor are unchanged. Conclusions require the actual CI observations; none are invented in this record.

Stopping rule: use this isolation evidence for one targeted simplification and actual runtime/compiled-size checks, or produce a reproducible compiler failure and explicit architecture/support decision. Subset success cannot replace whole-application certification.
