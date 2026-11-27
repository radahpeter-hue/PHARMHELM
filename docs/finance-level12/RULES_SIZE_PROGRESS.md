# Level 12 rules-size progress

All sizes below are local stripped emulator AST estimates. Exact hosted executable size was not returned for the deployed baseline. Source bytes are separate.

| Checkpoint | Previous estimate | New estimate | Delta | Validation |
| --- | ---: | ---: | ---: | --- |
| Fresh main baseline | historical 249605 | 249605 | 0 | Fresh emulator compiler measurement |
| Funding, allocation, recall and utilization | 249605 | 268044 | +18439 | Funding stages passed; initial employee-create runtime bug subsequently fixed |
| Transfer extension | 268044 | 269388 | +1344 | Transfer runtime budget required removing redundant linked validation |
| Optional-field-reader experiment | 269388 | 267944 | -1444 | Exact candidate certification and authorization equivalence still required |
| Smaller arrays and specialized paths | 267944 | 271326 | +3382 | Rejected experiment; not the release generator |

The current hardening candidate includes additional field allowlists and active-account checks. Remeasure before any release claim. Hosted certification and required CI are blocking, not optional. No rules release was activated.
