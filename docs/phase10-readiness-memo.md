# Memo: Should We Run QA Before Phase 10?

**From:** Cowork
**Date:** 2026-03-26
**Decision needed:** Run QA phase first, or run Phase 10 and QA in parallel?

---

## The call: Run QA first. Then Phase 10.

Here's the argument.

**Phase 10 is "First Real Email Campaign."** That means sending emails to real workshop contacts — potentially thousands of them. If the sequence engine, Gmail send queue, or Inngest job execution has a silent bug, you won't know until you've already:
- Sent duplicate emails to contacts
- Not sent anything and not known why
- Had Gmail OAuth tokens expire mid-sequence with no observable failure

Right now, you have zero automated visibility into whether the app is actually healthy. `npm run build` passing doesn't mean sequences enroll correctly or emails queue properly. It means TypeScript compiles.

**The QA phase is one CC session.** It installs Playwright, writes ~35 tests, and gives you a command you can run in 2 minutes against production after every deploy for the rest of the project's life. That's asymmetric value — you pay once, it protects you forever.

---

## The "run in parallel" argument, addressed

The obvious counterargument is: Phase 10 is the thing that makes the tool useful, QA is process overhead, just run them together.

The problem: QA *for* Phase 10 is different from QA *before* Phase 10. If you run the QA phase after Phase 10 code is merged, the E2E tests will be written against a codebase that includes Phase 10 changes. You lose the ability to establish a clean baseline — you won't know if a test failure is from the QA phase tests being wrong or from Phase 10 code being wrong. Running QA on a known-good deployment gives you a clean baseline you can trust.

Also: both phases share the "Jacob merges PR" bottleneck. Running them in parallel means two CC sessions and two PRs open simultaneously, which creates merge conflicts. Sequential is cleaner.

---

## What to do right now

1. **Jacob completes the two Phase 9 manual steps** (Supabase redirect URL, Google OAuth redirect URI). The app can't be fully tested until auth callbacks work.

2. **Cowork runs Phase QA** using `docs/prompts/phase-qa.md`. One CC session.

3. **Cowork merges, Jacob confirms**, and Cowork runs `TEST_BASE_URL=https://crm-for-saas.vercel.app npm run test:e2e` to get a clean baseline.

4. **Then Phase 10 starts.** From here on, every deploy has a 2-minute verification step.

---

## Risk if you skip QA and go straight to Phase 10

| Risk | Likelihood | Impact |
|------|-----------|--------|
| Sequence enrollment fails silently | Medium | High — campaign appears to run, nothing sends |
| Gmail OAuth refresh fails after token expiry | Medium | High — emails stop mid-campaign |
| Dashboard data is wrong (wrong workspace scope) | Low | Medium — misleading stats |
| A future Phase 10+ change breaks contacts CRUD | Low | High — noticed only when Jacob tries to use it |

None of these are theoretical. The CRM has already had RLS bugs (the workspace_members recursion issue) that caused silent failures. Without tests, you find these bugs when using the app in anger, not before.

---

## Time cost

| Option | Time to Phase 10 complete |
|--------|--------------------------|
| QA first, then Phase 10 | +1 CC session upfront, then Phase 10 runs with test coverage |
| Phase 10 first, QA later | Phase 10 runs without a safety net; QA session still needed after |
| Skip QA entirely | Save one session; accept permanent test-blind deployment |

The only real question is whether to defer QA to after Phase 10. I'd argue: the QA phase builds the foundation that makes Phase 10 trustworthy. Do it first.

---

**Recommendation: QA phase first, Phase 10 second. One session, then the next.**
