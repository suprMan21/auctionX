# AuctionX Development Plan — Post-Stabilization

**Date:** 2026-03-01
**Baseline:** Phase 0 complete (4 passes). 0 TS errors. Clean builds. Security patched.
**Strategy:** One module per Claude Code session. Prompts written by Opus, executed by Sonnet, QA'd by Opus.

---

## Dependency Graph

```
Module 06 (Browse & Search) ──────────┐
                                       ├──→ Module 14 (Enhanced Search)
Module 04/05 (Profiles/Listings) ✅ ──┘
                                       
Module 09 (Payment Hardening) ─────────→ Module 11 (Settlement) ──→ Module 12 (Payouts)

Module 10 (Admin Frontend) ────────────→ standalone (backend done)

Module 13 (NFC Verification) ──────────→ standalone (critical differentiator)

Module 15 (Messaging) ─────────────────→ standalone

Modules 06, 09, 10, 13, 15 ───────────→ Module 16 (Notifications)

All modules ───────────────────────────→ Module 17 (Testing) ──→ Module 18 (Launch)
```

---

## Execution Order

Each row is one Claude Code session. Sessions within the same tier can run in any order.

### Tier 1 — Core User Experience (what buyers/sellers see)
| Session | Module | What Gets Built | Depends On | Est. Complexity |
|---------|--------|-----------------|------------|-----------------|
| 1 | **06: Browse & Search** | Browse page, search bar, filters, category navigation, routes | Modules 05, 07 (done) | Medium |
| 2 | **10: Admin Frontend** | Admin dashboard UI, user management, moderation queue, audit logs | Module 10 backend (done) | Medium-High |

### Tier 2 — Transaction Pipeline (money flow)
| Session | Module | What Gets Built | Depends On | Est. Complexity |
|---------|--------|-----------------|------------|-----------------|
| 3 | **09: Payment Hardening** | Server-side content flag validation, Edge Function deploy prep, cascade testing stubs | Module 09 (patched in Phase 0) | Medium |
| 4 | **02→Backend: Port Auction Mechanics** | Move pure auction functions from `functions/` to `backend/src/lib/auction/` | Module 02 (locked) | Low |
| 5 | **11: Settlement** | Escrow hold, winner notification, cascade-to-next-bidder, dispute window | Modules 09, 02 port | High |
| 6 | **12: Payouts** | Auto-release after escrow, seller payout calculations, payout history | Module 11 | Medium |

### Tier 3 — Platform Differentiation
| Session | Module | What Gets Built | Depends On | Est. Complexity |
|---------|--------|-----------------|------------|-----------------|
| 7 | **13: NFC Verification** | Token generation, video proof capture, NFC programming flow, public verify page | Modules 05, 08 (done) | High |
| 8 | **14: Enhanced Search** | Full-text search (pg_trgm/tsvector), advanced filters, saved searches | Module 06 | Medium |
| 9 | **15: Messaging** | Buyer-seller messaging, conversation threads, notifications | Module 03 (done) | Medium |

### Tier 4 — Polish & Launch
| Session | Module | What Gets Built | Depends On | Est. Complexity |
|---------|--------|-----------------|------------|-----------------|
| 10 | **16: Notifications** | Email (Resend/SendGrid), push, in-app notification center | Modules 11, 15 | Medium |
| 11 | **17: Testing** | Playwright E2E suite, security audit, load testing | All modules | High |
| 12 | **18: Launch Prep** | Production env, monitoring, backups, CI/CD, domain config | Module 17 | Medium |

---

## Session Workflow (Every Module)

```
1. Opus writes module prompt (here in chat)
2. You open fresh Claude Code session
3. cd projectClaude/
4. Paste module prompt → execute
5. Bring verification results back to Opus
6. Opus QA's → green light or revision
7. Commit → next module
```

---

## Prompt Template (What Each Module Prompt Contains)

Every module prompt follows the same structure:
- **Context:** What this module does, where it fits
- **Pre-check:** Verify builds, verify dependencies are in place
- **Schema changes:** Any migrations needed (created + pushed)
- **Backend work:** API routes, controllers, Edge Functions
- **Frontend work:** Pages, components, routes, stores
- **Wiring:** Routes in App.tsx, navigation links, store integration
- **Verification:** Type check, build, manual test instructions
- **Commit message**

---

## Progress Tracker

| Session | Module | Status | Date | Commit |
|---------|--------|--------|------|--------|
| — | Phase 0 (Passes 1-4) | ✅ Complete | 2026-03-01 | 4 commits |
| 1 | 06: Browse & Search | ⬜ Not started | | |
| 2 | 10: Admin Frontend | ⬜ Not started | | |
| 3 | 09: Payment Hardening | ⬜ Not started | | |
| 4 | 02: Port Auction Mechanics | ⬜ Not started | | |
| 5 | 11: Settlement | ⬜ Not started | | |
| 6 | 12: Payouts | ⬜ Not started | | |
| 7 | 13: NFC Verification | ⬜ Not started | | |
| 8 | 14: Enhanced Search | ⬜ Not started | | |
| 9 | 15: Messaging | ⬜ Not started | | |
| 10 | 16: Notifications | ⬜ Not started | | |
| 11 | 17: Testing | ⬜ Not started | | |
| 12 | 18: Launch Prep | ⬜ Not started | | |

---

## Notes

- **One module = one Claude Code session.** Sonnet's context window can't handle multi-module sessions effectively.
- **Always start fresh sessions.** Don't reuse sessions across modules.
- **Opus QA between every module.** Bring verification results back to Opus before starting the next one.
- **Commit after every module.** Clean git history, easy rollback.
- **Module prompts are written just-in-time.** Opus writes the next 2-3 prompts after each QA pass, not all 12 upfront, because later prompts depend on what earlier sessions actually produce.
