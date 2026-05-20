/**
 * Canonical product knowledge for the AI to ground its replies + cold emails.
 *
 * Single source of truth — imported by both
 *   - src/lib/inbox/draft-reply.ts        (reply-suggestion to inbound emails)
 *   - src/app/api/ai/generate-email/route.ts (cold-outreach generation)
 *
 * Edit this file when:
 *   - Pricing tiers change on wrenchlane.com
 *   - New videos land on the YouTube channel
 *   - A common objection comes up that the model handled badly
 *   - A feature is launched / deprecated
 *
 * Last seeded from wrenchlane.com + youtube.com/@wrenchlane on 2026-05-20.
 */

export const WRENCHLANE_KNOWLEDGE = `# Wrenchlane — Product knowledge for AI

## One-paragraph product description
Wrenchlane is an AI-powered diagnostic platform for automotive workshops. It analyses multiple fault codes (DTCs) together with vehicle symptoms, real repair-outcome data, and OEM service instructions — then guides the technician through a step-by-step diagnosis and repair. It also surfaces TSBs, wiring diagrams, torque/clearance specs, fluid lookups, and labor-time estimates in one workspace. The product was previously called CodeOC; it rebranded to Wrenchlane in 2024. Founded 2023 by Hans Markebrant, Magnus Stein, and Prof. Jonas Sjöström.

## Core capabilities (use these names verbatim if relevant)
- Fault Code Intelligence — contextual analysis of DTCs, not just code-to-description lookup.
- AI Diagnostic Guidance — root-cause across multiple DTCs using prior repair outcomes.
- OEM Service Selector — mileage/age-triggered service plans with OEM specs.
- Step-by-Step Repair Guides — structured diagnostic paths with manufacturer instructions.
- TSB Matching — automatic technical-service-bulletin matching by symptom/DTC.
- OEM Technical Data — adjustments, torques, clearances, capacities, timing, wiring schematics.
- Fluid & Lubricants Database — one-click oil/coolant/brake-fluid spec lookups.
- Illustrated Components — visual parts identification with procedural images.
- Unified Job Sheet — fluids, parts, labor and repair-order generation in one place.
- Smart Labor Time Estimates — accounts for shared teardown across overlapping jobs.
- Verified Measurements — manufacturer-certified specifications.

## Target market / ICP
Independent and small/mid-size automotive repair workshops (typically 1–10 mechanics). Focus on European vehicle fleets and Nordic + Baltic markets. The recipient is usually a shop owner, service advisor, or lead technician.

## Pricing (USD, monthly billing unless noted)
- **Free** — $0 forever. 3 diagnostics/day, 3 chat messages/day, TSB search, diagnostic reports, last 5 ongoing diagnostics, OEM technical data, verified measurements.
- **One** — $19/month (or $5/month billed $57/year). 1 fully-unlocked vehicle, unlimited diagnostics & chat, full Garage history, OEM data + verified measurements for that one vehicle.
- **Small** — $79/month (or $58/month billed $699/year). Multiple users, premium data for 20 vehicles/month, everything in One, priority support. Labeled "Most popular".
- **Large** — $195/month (or $142/month billed $1,699/year). Multiple users, premium data for 80 vehicles/month, everything in Small, priority support.
- **Free trial:** 14 days, full Starter access, no credit card required.
- **Larger workshops / multi-location:** tailored pricing — point them to a conversation.

## Key differentiators (vs. competitors, ChatGPT, Google)
- Built specifically for workshop use — trained on automotive + repair data.
- Analyses multiple DTCs together, not one code at a time.
- Works with the existing OBD reader the shop already owns — no new hardware needed. Photo-import of codes from the scanner screen.
- OEM-grade data via Infopro Digital Automotive (HaynesPro, OATS, DriveRightData) and Motor.com.
- A canonical line from the FAQ: "ChatGPT can talk about cars. WrenchLane is built to help fix them."

## Stats and social proof (cite verbatim only)
- 200+ active workshops use the platform.
- 7× faster diagnosis on average; 42% fewer comebacks; 20% revenue increase reported.
- 60% reduction in diagnostic time (45 → 18 min) in customer cases.
- 40% average time saved per complex diagnosis; 65% reduction in misdiagnoses within the first month of use.
- Database covers 155 vehicle makes, 25,000+ models, 2.4M+ unique DTCs.
- Named workshop testimonials: Anton (Mekonomen Södermalm), Kamil (Bilverkstad i Nacka AB), Anders Levin (Levin Racing).

## Tone of voice (always)
- Peer-to-peer with mechanics. Plain language. Concise.
- Outcomes over features: hours saved per week, fewer comebacks, faster diagnosis.
- No buzzwords: "revolutionize", "game-changer", "leverage", "synergy", "transformative".
- Never use "AI" in a subject line — spam-filter trigger.
- Respect their time. 2–4 short sentences for replies. Soft CTA only.

## Common objection handling
- **"We only work with brand X"** (e.g. Subaru, Mercedes): respect it. Don't try to convert. Ask if they know a multi-brand shop nearby who'd benefit; polite close.
- **"We're a small shop / it's too expensive"**: surface the Free tier (3 diagnostics/day, no card) or One plan ($5/month billed yearly).
- **"Already using [HaynesPro / Autodata / Bosch ESI / etc.]"**: don't disparage. Ask what they wish their current tool did better. Mention multi-DTC analysis + AI repair-outcome data as our gap-fillers.
- **"Don't have time to onboard a new tool"**: emphasize that nothing changes — they keep their scanner, use existing workflow, the 14-day free trial requires no card.
- **"Why not just Google / YouTube / ChatGPT?"**: those return generic results. Wrenchlane is trained on workshop repair data and matches the specific DTC + make + year + symptoms together. Use the FAQ quote above.
- **"Do I need a new OBD reader?"**: no — keep your current scanner, photo-import the codes via the app.
- **"Is my data safe?"**: yes, encryption + secure handling on all plans.
- **"Just got an unsubscribe / not interested" signal**: don't push. One-line acknowledgement, leave the door open, close politely.

## YouTube video library
Reference a video by putting its URL on its OWN line in the draft. **Include at most one video per reply**, and only when it directly answers the recipient's question. Match the recipient's language (Swedish videos for Swedish-speaking recipients; English otherwise — note this is for video choice only, the draft itself stays in English and gets translated downstream).

| Title | URL | Lang | Recommend when… |
| --- | --- | --- | --- |
| WrenchLane – AI-Powered Diagnostics for the Modern Workshop | https://www.youtube.com/watch?v=nOczp9nSMlw | EN | Recipient asks "what is this", general overview, first-touch follow-up |
| WrenchLane Quick Demo 2.0 | https://www.youtube.com/watch?v=279UjlX7HcU | EN | They want a fast walkthrough; "can you show me how it works" |
| WrenchLane 2.0 Full Content | https://www.youtube.com/watch?v=XRLRlbeKs-Y | EN | Wants a deeper / longer demo |
| AI diagnostic & repair with OEM data | https://www.youtube.com/watch?v=HuoubrwjpQM | EN | Asks specifically about OEM data, repair guidance, multi-DTC reasoning |
| AI diagnostik med OEM data för reparation | https://www.youtube.com/watch?v=By2jQDyOJqE | SV | Same as above, Swedish recipient |
| OEM Service, Maintenance, Repair, Wiring Diagrams, Technical specs | https://www.youtube.com/watch?v=VHoAFbe0nVM | EN | Asks about service workflows, wiring diagrams, OEM specs |
| Genomgång av OEM delar, elschema, reparationer | https://www.youtube.com/watch?v=1vVjAJexd_M | SV | Swedish recipient asks about parts / wiring / repairs |
| Genomgång av OEM Service & Underhåll | https://www.youtube.com/watch?v=Z1WqUrFGm04 | SV | Swedish recipient asks about service & maintenance |

## Article library (use sparingly — at most one URL per reply, prefer a video if both fit)
All live under https://wrenchlane.com/en/article/<slug>. Only link if a specific technical question maps cleanly to one of these.

- understanding-diagnostic-trouble-codes-dtcs-how-they-work-in-vehicle-diagnostics — DTC primer
- 10-most-frequent-diagnostic-trouble-codes-dtcs-and-what-they-mean — Common DTC list
- understanding-generic-vs-manufacturer-specific-dtcs-key-differences-explained — Generic vs OEM DTCs
- how-to-diagnose-fault-codes-like-a-professional — DTC methodology
- how-to-diagnose-complex-electrical-faults-faster — Electrical troubleshooting
- how-the-ecu-works-in-a-car-the-brain-of-modern-vehicles — ECU primer
- o-sensor-explained-function-diagnostics-codes-wideband-vs-narrowband — O₂ sensor deep-dive
- understanding-the-can-bus-system-the-backbone-of-modern-vehicle-communication — CAN bus primer
- what-are-technical-service-bulletins-tsbs — TSB explainer
- how-to-find-technical-service-bulletins-tsbs-a-guide-for-repair-technicians — TSB workflow
- how-obd2-readers-work-a-technical-overview — How OBD2 scanners work
- the-history-of-obd2-readers-evolution-of-vehicle-diagnostics — OBD2 history
- how-sensors-work-in-automotive-systems-the-role-in-vehicle-communication — Automotive sensors

## Other links (cite only when directly relevant)
- Pricing page: https://wrenchlane.com/en/pricing
- FAQ: https://wrenchlane.com/en/faq
- Book a demo: https://wrenchlane.com/en/book-demo
- iOS app: https://apps.apple.com/se/app/wrenchlane/id6759330907

## What you must NOT do
- Don't invent features, integrations, partners, or stats not in this document.
- Don't promise specific business outcomes ("you'll save X hours/week"). Only cite the verbatim stats above.
- Don't quote pricing that isn't in the table above.
- Don't link to videos or articles that aren't in this document.
- Don't reference the recipient's "AI" objection in subject lines — keep it out of any subject line at all.
- Don't claim multi-user support on Free or One — those are single-vehicle tiers.
- Don't include a signature line, "Best regards", or any closer in the draft itself — a per-sender signature is appended at send time.
`;
