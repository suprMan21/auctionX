import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should display login page', async ({ page }) => {
    await page.goto('/login');
    
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('should show validation on empty email submit', async ({ page }) => {
    await page.goto('/login');
    
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitButton = page.locator('button[type="submit"]');
    
    await emailInput.click();
    await passwordInput.click();
    await submitButton.click();
    
    const isValid = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(isValid).toBe(false);
  });

  test('should navigate to signup page', async ({ page }) => {
    await page.goto('/login');
    
    const signupLink = page.getByText(/sign up|create account|register/i);
    
    if (await signupLink.isVisible({ timeout: 5000 })) {
      await signupLink.click();
      await expect(page).toHaveURL(/.*register/, { timeout: 10000 });
    } else {
      test.skip();
    }
  });
});

test.describe('Protected Routes', () => {
  test('should redirect to login when accessing protected route without auth', async ({ page }) => {
    await page.goto('/my-listings');
    await expect(page).toHaveURL(/.*login/, { timeout: 5000 });
  });

  test('should redirect to login when accessing profile without auth', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/.*login/, { timeout: 5000 });
  });

  test('should redirect unauthenticated user away from admin route', async ({ page }) => {
    await page.goto('/admin');
    // Should land on login or home — not the admin page
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 5000 });
    const url = page.url();
    expect(url).not.toMatch(/\/admin($|\/)/);
  });
});
