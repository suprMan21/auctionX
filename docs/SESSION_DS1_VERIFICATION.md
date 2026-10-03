# Session DS1 Verification: Design System on Material Design 3

**Date:** 2026-10-02 to 2026-10-03
**Scope:** New design system repo + Notion design/decision/idea cleanup. No changes to the app code in this repo.

## 1. Design system repo

| Item | Value |
|---|---|
| Location | `projectClaude/am-design-system/` (sibling of this repo, not inside it) |
| Remote | `git@github.com:suprMan21/authenticMaterialsDesign.git` |
| Package | `@authentic-materials/ui` v0.1.0 |
| Commit | `13e729b` on `main`, pushed by Boss, SSH-signed |
| Stack | React 19, TS 5.9, Tailwind 3.4 preset, Headless UI 2, cva, Vite 7, Vitest 4 |

### Verification (`npm run check`)

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Vitest + Testing Library + axe | 296 / 296 passed, 41 files |
| WCAG contrast gate (`npm run contrast`) | all role pairings pass AA, App + Cinema themes |
| Library build (tsup ESM + CJS + d.ts) + `dist/styles.css` | pass |
| Playground build | pass; screenshot-checked in Chrome (button, color, text field, card, chips, nav bar, date picker, Cinema theme) |

### Decisions applied (Boss, 2026-10-02)

- M3 is the blueprint, AM is the look. Separate repo so app/backend repos never carry the library.
- Token conflicts: code values win (bg `#13131a`, cards 20px, buttons 12px, text `#fff`); violet-400 restored to `#a78bfa`.
- Buttons: M3 set mapped (Filled = gradient, Tonal = glass, Outlined, Text). Supersedes "two variants only".
- Full M3 component parity; App + Cinema themes.
- Found by the contrast gate: `#7c3aed` fails 3:1 as an indicator on raised surfaces; brand is fill-only, indicators and focus ring use `#a78bfa`.

### Known gaps (documented in repo)

Clock-dial time picker, date ranges, M3 carousel keyline masking.

## 2. Notion changes

- Decision (Locked): design system M3 blueprint + separate repo.
- Design System DB: new "M3 Foundation" entry; Buttons entry Deprecated; v4.0 callouts on 7 entries; Master Design System v3.1 to v4.0 (Quick Reference corrected, version history table repaired).
- **Decisions DB merged** (two live DBs: local CLAUDE.md and Notion CLAUDE.md pointed at different ones). Single DB `collection://c9cbe6a2…` now at workspace root; 99 entries; 13 duplicates marked Superseded with pointers; date column renamed to `Decision Date`; Impact + Review Priority backfilled on the 46 merged rows; taxonomy reference created.
- **Ideas DB merged** the same way into `collection://0e909565…` (31 entries, 3 Duplicate); taxonomy reference created.
- Both CLAUDE.md copies repointed; Notion CLAUDE.md v38.0 to v38.2.
- Lessons Learned: 4 entries. Feature Backlog: S-DS2 (frontend adoption, Planned) and Module 19 App Runner to ECS (Backlog).

## 3. Deferred / needs Boss

- Decision "Everything Ships Together (Marketplace Waits for Flutter)" is still Locked but conflicts with the token-first pivot. Supersede or keep?
- S-DS2: adopt the package in the frontend (separate session). Start from `am-design-system/docs/ADOPTION.md` step 1.
