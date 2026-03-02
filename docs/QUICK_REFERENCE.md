# AuctionX - Quick Reference

**Fast lookup for common tasks.**

---

## Project Locations
```
Main repo: auctionX-dev/
Backend: functions/
Frontend: frontend/
Docs: docs/
```

---

## Key Files

**Must Read Before Coding:**
- `docs/SCHEMA_LOCK.md` - What you CANNOT change
- `docs/MASTER_SPECIFICATION.md` - Business rules & API
- `docs/MODULE_WORKFLOW.md` - How to use module prompts

**Track Progress:**
- `docs/DEVELOPMENT_CHECKLIST.md`

---

## Commands

**Backend:**
```bash
cd functions
npm run build      # Compile
npm test          # Test
npm run serve     # Local (port 5001)
```

**Frontend:**
```bash
cd frontend  
npm run dev       # Dev server (port 3000)
npm run build     # Production build
```

---

## Module Prompts

Located: `/mnt/project/`

1. Upload appropriate prompt to new chat
2. Attach SCHEMA_LOCK.md
3. Reference Master Spec sections
4. Begin module work

---

## Schema Rules

✅ **SAFE:**
- Add optional fields
- Add new enum values (end only)

❌ **BREAKING:**
- Remove/rename fields
- Change types
- Remove enum values

---

## Git Workflow
```bash
git checkout -b module-name
# ... work ...
npm test              # Both repos
git add -A
git commit -m "feat(module): description"
git push
```

---

## Emergency

**Build broken?**
```bash
git log --oneline     # Check recent changes
git diff HEAD~1       # See last commit
git reset --hard HEAD~1  # Undo if needed
```

**Schema conflict?**
Check `SCHEMA_LOCK.md` for violations

---

**END OF QUICK REFERENCE**
