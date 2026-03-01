# Claude Code Session Prompts

## Current Priority: Phase 0 Stabilization

The codebase audit is complete (`docs/AUDIT_REPORT.md`). Both builds fail. There's a security issue in production.

**Next session:** Copy the contents of `docs/PHASE_0_STABILIZATION_PROMPT.md` and paste into Claude Code.

**After Phase 0 is done:** Use `/project:module-start` to begin fixing broken modules (Phase 1).

---

## Session Start Checklist

Every Claude Code session, before doing anything:

1. Confirm you're in the right directory:
   ```bash
   cd /Users/chris/Desktop/projectClaude/unmentionables/Unmen/
   ```

2. Check current build health:
   ```bash
   cd frontend && npx tsc --noEmit 2>&1 | tail -5
   cd ../backend && npx tsc --noEmit 2>&1 | tail -5
   ```

3. Check git status:
   ```bash
   git status
   git log --oneline -3
   ```

4. Read relevant docs for the task at hand (CLAUDE.md is auto-loaded).

---

## Quick Reference: Custom Commands

| Command | Purpose |
|---------|---------|
| `/project:audit` | Full codebase audit |
| `/project:module-start` | Plan a new module (reads status + schema lock first) |
| `/project:test-module` | Run all tests for current module |
| `/project:deploy-check` | Pre-deployment validation |
| `/project:schema-check` | Verify no locked schema violations |
