# CRM Roadmap — Post Phase 8

Last updated: 2026-03-24 — **⚠️ STALE.** For current phase state, see `PROJECT-STATUS.md` and `cc-session-log.md`. As of 2026-04-24 the roadmap below is largely complete (Phases 9–24 shipped + SE-Stockholm-1→5 + CZ/SK/LV/EE/LT scrapes + MillionVerifier swap + TipTap rich email editor). Kept for historical intent.

## Where We Are

Phases 1–8 deliver the core CRM shell: contacts, companies, deals, Gmail integration, email sequences, tracking, lists, and dashboard. But none of it has been tested with real data, deployed to production, or used for actual outreach.

## Two Tracks

### Track A: Launch (make it work)
Get the CRM deployed, loaded with real data, and running real email campaigns. This is the critical path — nothing else matters until the system is actually sending emails and tracking results.

### Track B: Power (make it competitive)
Features that turn a basic CRM into something that gives Wrenchlane a real edge in outbound sales to automotive workshops.

---

## Track A: Launch

### Phase 9: Production Deployment + Data Loading
**Goal:** CRM is live on a real domain, with real contacts.

- Deploy to Vercel (connect GitHub repo, set env vars)
- Set up custom domain (crm.wrenchlane.com or similar)
- Configure production Supabase (if needed — or keep current project)
- Connect real Gmail account(s) for sending
- Complete Google OAuth consent screen verification (required for sending to external recipients)
- Load real workshop contacts via CSV import (10,000+ from purchased lists or scraped data)
- Create companies for major workshop chains and independents
- Set up pipeline stages that match Wrenchlane's actual sales process
- Test the full flow end-to-end: contact → sequence → email sent → open tracked → reply detected
- Set up cron jobs on Vercel for email processing (process-emails, check-replies, reset-daily-sends)

### Phase 10: Email Sequence Content + First Campaign
**Goal:** First real outbound campaign running.

- Write email templates using ICP data (technician pain points, shop owner ROI, service advisor workflow gains)
- Build 3-5 email sequences targeting different personas:
  - Shop owners: ROI and efficiency pitch
  - Service advisors: workflow improvement angle
  - Technical decision makers: AI diagnostics angle
- Create contact lists segmented by persona/role
- Set up A/B test variants for subject lines
- Launch first sequence with a small test batch (50-100 contacts)
- Monitor deliverability, open rates, bounce rates
- Iterate on content based on results
- Scale to full list once deliverability is confirmed

### Phase 11: Sender Warmup + Deliverability
**Goal:** Sustainable sending at scale without hitting spam.

- Set up 3-5 Gmail sending accounts for rotation
- Implement warmup schedule (start low, ramp up over 2-4 weeks)
- Configure SPF, DKIM, DMARC for wrenchlane.com
- Monitor sender reputation
- Add custom tracking domain (track.wrenchlane.com) to avoid shared domain reputation issues
- Implement sending throttling and daily limits per account
- Set up bounce handling and auto-suppression
- Create unsubscribe compliance flow (CAN-SPAM / GDPR)

---

## Track B: Power Features

### Phase 12: Contact Enrichment + Research
**Goal:** Know more about each prospect before reaching out.

- Integrate with enrichment APIs (Apollo, Clearbit, or similar) to fill in missing data:
  - Company size, revenue, industry
  - Contact title, LinkedIn URL
  - Technology stack (what shop management system they use)
- Auto-enrich on import or on-demand
- Add "Research" view per contact/company showing enriched data
- Score contacts based on ICP fit (workshop size, location, current tools)

### Phase 13: AI Email Writer
**Goal:** Generate personalized emails at scale using ICP knowledge.

- Integrate Claude API for email generation
- Use ICP docs (target-personas.md, product-vision.md) as system context
- Generate personalized first-touch emails based on:
  - Contact's role (technician, advisor, owner)
  - Company size and type (independent shop, chain, dealer)
  - Known pain points from ICP research
- "Generate Email" button in sequence builder that writes step content
- "Personalize" button on individual contacts that tailors template to their profile
- Review/edit flow — AI drafts, human approves

### Phase 14: Inbox + Reply Management
**Goal:** Handle replies without leaving the CRM.

- Unified inbox showing all replies across Gmail accounts
- Thread view: see full email conversation per contact
- Quick reply from CRM (compose + send via Gmail API)
- Auto-categorize replies: interested, not interested, out of office, bounced
- One-click actions: book meeting, add to deal, mark as qualified, unsubscribe
- Reply detection updates contact's lead_status automatically

### Phase 15: Meeting Booking Integration
**Goal:** Convert interested replies into scheduled calls.

- Integrate with Cal.com or Calendly (or build simple availability picker)
- Include booking link in email templates
- Track booking events as activities
- Auto-create deal when meeting is booked
- Sync with Google Calendar

### Phase 16: Advanced Analytics + Attribution
**Goal:** Know exactly what's working.

- Sequence-level analytics: which sequence converts best
- Step-level analytics: which email in a sequence gets the most replies
- A/B test results with statistical significance
- Contact timeline: full history from first email to closed deal
- Revenue attribution: which sequence/campaign generated which deals
- Export reports as CSV or PDF

---

## Prioritization

The order above is intentional. Track A (Phases 9-11) must come first — a CRM that isn't sending real emails is just a demo. Track B features can be interleaved once the system is live.

Recommended execution order:
1. Phase 9 (deploy + data) — **do this immediately after Phase 8**
2. Phase 10 (first campaign) — **this is the money shot**
3. Phase 11 (warmup + deliverability) — **run in parallel with Phase 10**
4. Phase 14 (inbox) — **needed once replies start coming in**
5. Phase 13 (AI writer) — **high leverage for scaling content**
6. Phase 12 (enrichment) — **improves targeting**
7. Phase 15 (meetings) — **conversion optimization**
8. Phase 16 (analytics) — **once there's enough data to analyze**

---

## Notes

- Wrenchlane sells AI-powered workshop management software to automotive repair shops
- Same ICP as Anderson Car System (see docs/icp/)
- Target personas: technicians, service advisors, shop owners/managers
- Key markets: Nordic (starting), then Europe, then US
- Competitive landscape is fragmented — no dominant player owns the full workflow
- The CRM is a weapon for Wrenchlane's outbound sales motion, not a product to sell
