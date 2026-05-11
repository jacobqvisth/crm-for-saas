# Hans manual outreach JSON

`hans-manual-outreach.json` is the cleaned, classified row set extracted from
`_inbox/wrenchlane_verkstadsmail_2025-2026.xlsx` (Hans's personal Gmail
outreach ledger covering 2025-03 → 2025-11, 82 threads).

## Extraction

The xlsx lives in the planning vault, not the repo. To regenerate this file
from a fresh xlsx, run the Python snippet captured in the import session
(`/tmp/xlsxenv/bin/python` + openpyxl). Skipped: 3 internal/self-test rows
(magnus@wrenchlane.com ×2, hans@wrenchlane.com).

## Classifications

Each row has `classification` set by `scripts/import-hans-outreach.mjs`'s
PROFILE map:

| Class        | Why                                | Tags applied                          |
|--------------|------------------------------------|---------------------------------------|
| `cold`       | `svarat=Nej`, no reply received    | `manual-outreach-2025`                |
| `mid_stage`  | Replied, mid-conversation          | `manual-outreach-2025`, `hot-replied-2025` |
| `late_stage` | Replied, Hans owed an action       | `manual-outreach-2025`, `hot-replied-2025` |
| `customer`   | Already paying / using app         | `manual-outreach-2025`, `hot-replied-2025`, `customer_status=active` |

Hot-thread overrides live in the Python snippet (see commit history).
