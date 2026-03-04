import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'path';
import fs from 'fs';
import { TEST_ROUTES, getRoutePath } from './routes';

const SCREENSHOT_DIR = path.resolve(__dirname, '../reports/screenshots');
const REPORT_DIR = path.resolve(__dirname, '../reports');
const AXE_DIR = path.resolve(REPORT_DIR, 'axe');

// Ensure output directories exist
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(AXE_DIR, { recursive: true });

type AxeViolation = {
  id: string;
  impact: string | null;
  description: string;
  nodes: number;
};

type RouteAxeResult = {
  route: string;
  name: string;
  violations: AxeViolation[];
  passes: number;
  incomplete: number;
};

const allAxeResults: RouteAxeResult[] = [];

for (const route of TEST_ROUTES) {
  const url = getRoutePath(route);

  // Tag in describe block name enables project grep filtering (@public, @user, @admin)
  test.describe(`Visual @${route.auth}: ${route.name}`, () => {
    test(`${route.name} — fullpage screenshot @${route.auth}`, async ({ page }) => {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${route.name}-fullpage.png`),
        fullPage: true,
      });
    });

    test(`${route.name} — viewport screenshot @${route.auth}`, async ({ page }) => {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${route.name}-viewport.png`),
        fullPage: false,
      });
    });

    test(`${route.name} — WCAG 2.2 AA accessibility scan @${route.auth}`, async ({ page }) => {
      await page.goto(url, { waitUntil: 'networkidle' });

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();

      const violations = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        description: v.description,
        nodes: v.nodes.length,
      }));

      // Write per-route axe JSON (canonical source for /review-screenshot skill)
      const perRouteReport = {
        route: url,
        name: route.name,
        auth: route.auth,
        description: route.description,
        generatedAt: new Date().toISOString(),
        violations,
        passes: results.passes.length,
        incomplete: results.incomplete.length,
      };
      fs.writeFileSync(
        path.join(AXE_DIR, `${route.name}.json`),
        JSON.stringify(perRouteReport, null, 2),
      );

      // Collect for aggregate report
      allAxeResults.push({
        route: url,
        name: route.name,
        violations,
        passes: results.passes.length,
        incomplete: results.incomplete.length,
      });

      // Always passes — violations are advisory only
      expect(results).toBeDefined();
    });
  });
}

// Write aggregated axe report after all tests complete (backward-compat with upload-report.ts)
test.afterAll(async () => {
  if (allAxeResults.length === 0) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(REPORT_DIR, `axe-${timestamp}.json`);

  const totalViolations = allAxeResults.reduce((sum, r) => sum + r.violations.length, 0);
  const criticalViolations = allAxeResults.reduce(
    (sum, r) => sum + r.violations.filter((v) => v.impact === 'critical').length,
    0,
  );
  const seriousViolations = allAxeResults.reduce(
    (sum, r) => sum + r.violations.filter((v) => v.impact === 'serious').length,
    0,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      routesTested: allAxeResults.length,
      totalViolations,
      criticalViolations,
      seriousViolations,
      moderateViolations: allAxeResults.reduce(
        (sum, r) => sum + r.violations.filter((v) => v.impact === 'moderate').length,
        0,
      ),
      minorViolations: allAxeResults.reduce(
        (sum, r) => sum + r.violations.filter((v) => v.impact === 'minor').length,
        0,
      ),
    },
    routes: allAxeResults,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Axe report written: ${outputPath}`);
  console.log(`   Total violations: ${totalViolations} (${criticalViolations} critical, ${seriousViolations} serious)`);
});
