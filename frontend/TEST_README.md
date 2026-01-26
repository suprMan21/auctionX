# AuctionX Testing Infrastructure

## Overview

Comprehensive testing setup for Module 06 with four test tiers:
1. **Preflight** - Environment validation before development
2. **Integration** - Component and logic testing
3. **E2E** - Full user flow testing with Playwright
4. **Postflight** - Production deployment validation

## Quick Start

```bash
# Install dependencies
npm install

# Run preflight tests (before starting work)
npm run test:preflight

# Run integration tests (during development)
npm run test:integration

# Run E2E tests (requires dev server)
npm run test:e2e

# Run all tests
npm run test:all

# Generate coverage report
npm run test:coverage
```

## Test Structure

```
src/test/
├── preflight/          # Environment validation
│   └── environment.test.ts
├── integration/        # Component & logic tests
│   ├── ErrorHandler.test.ts
│   └── ErrorBoundary.test.tsx
├── e2e/               # End-to-end tests
│   └── auth.spec.ts
└── postflight/        # Production validation
    └── deployment.test.ts
```

## Preflight Tests

**Purpose:** Validate environment before starting development

**When to run:** Start of each development session

**What it checks:**
- Environment variables configured
- Node.js version compatibility
- Dependencies installed
- Build configuration valid

```bash
npm run test:preflight
```

## Integration Tests

**Purpose:** Test components and business logic in isolation

**When to run:** During development after making changes

**What it tests:**
- ErrorHandler logic
- ErrorBoundary rendering
- Component behavior
- API integration (mocked)

```bash
npm run test:integration
npm run test:integration -- --watch  # Watch mode
```

## E2E Tests

**Purpose:** Test complete user flows in real browser

**When to run:** Before committing, before deployment

**What it tests:**
- Full authentication flow
- Protected route access
- Form submissions
- Navigation

```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Run E2E tests
npm run test:e2e

# With UI for debugging
npm run test:e2e:ui
```

## Postflight Tests

**Purpose:** Validate production deployment

**When to run:** After deploying to production

**What it checks:**
- Production URL accessible
- No development artifacts in build
- Security headers present
- API connectivity

```bash
npm run test:postflight
```

## Writing Tests

### Integration Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

### E2E Test Example

```typescript
import { test, expect } from '@playwright/test';

test('user can complete signup', async ({ page }) => {
  await page.goto('/register');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'Test123!@#');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/profile');
});
```

## Coverage Reports

Generate coverage report:

```bash
npm run test:coverage
```

View report:
```bash
open coverage/index.html
```

## Troubleshooting

### Preflight tests failing
- Check `.env` file has all required variables
- Verify Node.js version >= 18
- Run `npm install`

### Integration tests failing
- Clear test cache: `npx vitest run --clearCache`
- Check mock implementations in `src/test/setup.ts`

### E2E tests timing out
- Increase timeout in `playwright.config.ts`
- Check dev server is running on port 3000
- Verify network connectivity

### Postflight tests failing
- Verify production URL is correct
- Check deployment completed successfully
- Confirm environment variables set in Vercel

## CI/CD Integration (Future)

Tests will run automatically on:
- Pull request creation
- Push to main branch
- Pre-deployment hooks

```yaml
# .github/workflows/test.yml (example)
- run: npm run test:preflight
- run: npm run test:integration
- run: npm run test:e2e
```

## Best Practices

1. **Run preflight before starting work** - Catches environment issues early
2. **Write tests alongside features** - Don't defer testing
3. **Keep tests fast** - Mock external dependencies
4. **Test user behavior, not implementation** - Focus on outcomes
5. **Use E2E sparingly** - They're slow, use for critical paths only

## Debugging Tests

### Vitest (Integration)
```bash
# Run specific file
npm run test:integration -- ErrorHandler.test.ts

# Run in watch mode
npm run test:integration -- --watch

# Show console output
npm run test:integration -- --reporter=verbose
```

### Playwright (E2E)
```bash
# Run specific test
npm run test:e2e -- auth.spec.ts

# Debug mode (headed browser)
npm run test:e2e -- --debug

# Generate test code
npx playwright codegen http://localhost:3000
```

---

**Module 06 Status:** ✅ Testing Infrastructure Complete
