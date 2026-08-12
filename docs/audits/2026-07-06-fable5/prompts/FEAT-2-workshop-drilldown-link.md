# FEAT-2 · Link CRM company/contact ↔ workshop drill-down

- **Runner:** Sonnet · **Effort:** S · **Priority:** P1 · **Repo:** `~/crm-for-saas`

## Context
When a rep is selling to an existing app user, they can't jump from the CRM company/contact to the rich `/dashboard/workshops/[workshopId]` account view (usage, diagnostics, subscription). The link data already exists: `companies.wl_workshop_id`, the full `getWorkshopDetail` page, and the App User section on the contact detail.

## PROMPT
Wire the two views together.

1. On the company detail (and the App User section of contact detail), when `companies.wl_workshop_id` is set, render a link/button "View app account →" to `/dashboard/workshops/<wl_workshop_id>`.
2. On the `/dashboard/workshops/[id]` page, if a CRM company maps to this workshop (`companies.wl_workshop_id = id`), render a reverse link "Open in CRM →" to that company.
3. Guard for null (no linked workshop → no button). Respect any existing access checks on the dashboard route.

### Definition of done
- Bidirectional link renders only when the mapping exists and navigates correctly.
- `npm run lint` passes.

### Verify
Open a company that has a `wl_workshop_id` → click through to the workshop page and back. Open one without → no button. Drive with the `verify` skill.
