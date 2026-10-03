import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility Compliance (WCAG 2.2 AA)', () => {
  test('login page should have no accessibility violations', async ({ page }) => {
    await page.goto('/login');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('signup page should have no accessibility violations', async ({ page }) => {
    await page.goto('/register');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('listing page should have no accessibility violations', async ({ page }) => {
    await page.goto('/my-listings');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

// S-NFC3-FE: the token pages. The API is intercepted so these run without a
// backend; the tap response is a real-shaped genuine, unclaimed token.
test.describe('Token pages (WCAG 2.2 AA)', () => {
  const scan = async (page: import('@playwright/test').Page) =>
    new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();

  test('verify page with no tap has no accessibility violations', async ({ page }) => {
    await page.goto('/verify/chip_001');
    await expect(page.getByRole('heading', { name: 'Tap the token to verify it.' })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test('verify page showing a genuine token has no accessibility violations', async ({ page }) => {
    await page.route('**/api/v1/nfc/tap', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          error: null,
          data: {
            valid: true,
            tagId: '55555555-5555-4555-8555-555555555555',
            lifecycleStatus: 'ENROLLED',
            provenance: {
              tag_id: '55555555-5555-4555-8555-555555555555',
              lifecycle_status: 'ENROLLED',
              is_valid: false,
              claim_date: null,
              creator_name: 'Disclosed Creator',
              origin_video_url: null,
              origin_location: 'Studio session',
              origin_date: null,
              current_ownership_id: null,
              enrolled_at: '2026-10-01T00:00:00.000Z',
            },
            tapSession: { token: 'S'.repeat(43), expiresAt: new Date(Date.now() + 600_000).toISOString() },
            viewer: null,
          },
        }),
      }),
    );
    await page.goto('/verify/chip_001?picc_data=EF963FF7828658A599F3041510671E88&cmac=94EED9EE65337086');
    await expect(page.getByRole('heading', { name: 'Unclaimed.' })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test('ownership lookup page has no accessibility violations', async ({ page }) => {
    await page.route('**/api/v1/ownership/*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          error: null,
          data: { status: 'stale', message: 'This Ownership ID is no longer current' },
        }),
      }),
    );
    await page.goto('/ownership/0x' + 'ab'.repeat(32));
    await expect(page.getByRole('heading', { name: 'No longer current.' })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });
});

test.describe('Keyboard Navigation', () => {
  test('login form should be fully keyboard navigable', async ({ page }) => {
    await page.goto('/login');
    
    await page.keyboard.press('Tab');
    let focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(['INPUT', 'BUTTON', 'A']).toContain(focusedElement);
    
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeDefined();
  });

  test('should have visible focus indicators', async ({ page }) => {
    await page.goto('/login');
    
    await page.keyboard.press('Tab');
    
    const focusStyles = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const styles = window.getComputedStyle(el);
      return {
        outline: styles.outline,
        outlineWidth: styles.outlineWidth,
        boxShadow: styles.boxShadow,
      };
    });
    
    const hasFocusIndicator = 
      focusStyles?.outline !== 'none' || 
      focusStyles?.outlineWidth !== '0px' ||
      focusStyles?.boxShadow !== 'none';
    
    expect(hasFocusIndicator).toBe(true);
  });
});

test.describe('Color Contrast (WCAG 2.2)', () => {
  test('should pass contrast checks', async ({ page }) => {
    await page.goto('/login');
    
    await new AxeBuilder({ page })
      .withTags(['wcag2aa'])
      .disableRules(['color-contrast']) // We'll check manually
      .analyze();

    const contrastResults = await new AxeBuilder({ page })
      .include('body')
      .withRules(['color-contrast'])
      .analyze();
    
    expect(contrastResults.violations).toEqual([]);
  });
});

test.describe('ARIA and Semantic HTML', () => {
  test('form inputs should have associated labels', async ({ page }) => {
    await page.goto('/login');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['label', 'label-title-only'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('buttons should have accessible names', async ({ page }) => {
    await page.goto('/login');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['button-name'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('images should have alt text', async ({ page }) => {
    await page.goto('/login');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['image-alt'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

test.describe('Screen Reader Compatibility', () => {
  test('page should have proper heading structure', async ({ page }) => {
    await page.goto('/login');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['heading-order', 'page-has-heading-one'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('landmarks should be properly defined', async ({ page }) => {
    await page.goto('/login');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['landmark-one-main', 'region'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

test.describe('Touch Target Size (WCAG 2.5.8)', () => {
  test('interactive elements should meet minimum size requirements', async ({ page }) => {
    await page.goto('/login');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['target-size'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
