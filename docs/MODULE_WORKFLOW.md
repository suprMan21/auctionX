# Module Development Workflow

**How to use module-specific prompts for development.**

---

## Available Module Prompts

Located in `/mnt/project/`:

1. **frontend-module-prompt.md** - For frontend feature modules
2. **base-master-prompt.md** - Base prompt for all modules
3. **prompt-usage-guide.md** - This guide

---

## Workflow: Starting a New Module

### Step 1: Create Module Chat

1. Open new Claude chat
2. Upload module prompt from `/mnt/project/`
3. Include current codebase context if needed

### Step 2: Set Module Context
```
I'm working on [MODULE_NAME] for Authentic Materials.

Current status:
- Completed modules: [list]
- Working on: [specific feature]

Reference docs:
- Schema Lock: [attach SCHEMA_LOCK.md]
- Master Spec: [relevant sections]

Task: [specific task description]
```

### Step 2.5: Review Master Lessons Learned (MANDATORY)

Before writing any code, review the relevant sections of `docs/MASTER_LESSONS_LEARNED.md`:
- **Always review:** Sections 1 (Schema), 2 (Express), 6 (Security), 8 (Testing)
- **If touching payments:** Section 4
- **If adding Edge Functions:** Section 3
- **If adding frontend pages:** Section 5
- **If writing migrations:** Section 7
- **Quick gotcha check:** Section 10 (table format)

### Step 3: Development

- Follow module prompt guidelines
- Check Schema Lock before ANY schema changes
- Test incrementally
- Commit frequently with descriptive messages

### Step 4: Module Completion

- [ ] All tests passing
- [ ] No schema violations
- [ ] Create module reference doc
- [ ] Update Development Checklist
- [ ] Commit with module tag: `feat(module-name): description`

---

## Module Types

### Frontend Modules

**Use:** `frontend-module-prompt.md`

**Examples:**
- Authentication UI
- Listing creation form
- Auction bidding interface
- User profile pages
- Admin dashboard

**Key Points:**
- Follow WCAG 2.2 AA standards
- Use Tailwind + Headless UI
- Zustand for state management
- React Router for navigation

### Backend Modules

**Use:** `base-master-prompt.md` + backend context

**Examples:**
- Payment processing
- Notification system
- Admin actions
- Reporting & analytics

**Key Points:**
- Check Schema Lock FIRST
- Use existing repo patterns
- Add tests for new logic
- Document API changes

### Integration Modules

**Use:** `base-master-prompt.md` + integration docs

**Examples:**
- Yoti age verification
- Segpay payment processor
- Email service
- CloudFront CDN

**Key Points:**
- Isolate in separate service files
- Mock external APIs for testing
- Handle failures gracefully
- Document rate limits

---

## Cross-Module Dependencies

### Before Starting

Check what modules your work depends on:
```
Authentication → User profiles → Listing creation → Auctions
```

### Module Interfaces

Each module should export clear interfaces:

**Example:**
```typescript
// Auth module exports
export { useAuth, requireAuth, AuthProvider };

// Listings module imports
import { useAuth } from '@/modules/auth';
```

---

## Testing Strategy

### Per-Module Testing
```bash
# Backend module
cd functions
npm run test:module-name

# Frontend module  
cd frontend
npm run test src/modules/module-name
```

### Integration Testing

After completing module:
```bash
# Full backend test
cd functions
npm test

# Full frontend test
cd frontend
npm run build
npm run test
```

---

## Module Prompt Template

When creating a new module chat:
```
You are helping build [MODULE_NAME] for Authentic Materials, a dual-brand auction marketplace operated by The Craving Company Inc.

PROJECT CONTEXT:
- Tech: React 19, Express 5, Supabase, S3
- Brand: Authentic Materials (SFW, public) + Unmentionables (NSFW, age-gated). Underlying DB enum: `brand_type` = AUCTIONX (Authentic Materials stream, schema-locked legacy identifier) or UNMENTIONABLES.
- Status: [list completed modules]

LOCKED COMPONENTS:
- Schemas: See attached SCHEMA_LOCK.md
- Module 01: Core domain models (DO NOT MODIFY)
- Module 02: Auction mechanics (DO NOT MODIFY)

CURRENT TASK:
[Describe specific module goal]

CONSTRAINTS:
- No breaking changes to locked schemas
- Follow existing patterns in codebase
- WCAG 2.2 AA compliance for UI
- Test coverage required

DELIVERABLES:
- Working code
- Tests
- Module reference doc
- Updated checklist

Ready to begin?
```

---

## Common Pitfalls

❌ **Modifying locked schemas without migration**
✅ Add optional fields, document in Schema Lock

❌ **Breaking existing module interfaces**
✅ Extend interfaces, maintain backward compatibility

❌ **Not testing against existing data**
✅ Run tests with sample data before committing

❌ **Forgetting to update documentation**
✅ Create/update module docs before marking complete

---

## Module Reference Doc Template

Create in `docs/MODULE_XX_[NAME]_REFERENCE.md`:
```markdown
# Module XX: [Name]

**Version:** 1.0.0  
**Date:** [Date]  
**Status:** Complete

## Purpose

[What this module does]

## Architecture

[Key components, data flow]

## API

[Exported functions, components, hooks]

## Dependencies

[What this module depends on]

## Testing

[How to test this module]

## Future Work

[Known limitations, planned improvements]
```

---

**END OF MODULE WORKFLOW**
