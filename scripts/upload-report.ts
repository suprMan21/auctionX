#!/usr/bin/env tsx
/**
 * upload-report.ts — Reads local Playwright + axe reports, pushes versioned
 * review reports to the Notion "Review Reports" database, and manages local +
 * remote retention.
 *
 * Usage:
 *   tsx upload-report.ts --mode both
 *   tsx upload-report.ts --mode smoke
 *   tsx upload-report.ts --mode visual
 *
 * Requires NOTION_API_KEY in env or scripts/.env
 */

import fs from 'fs';
import path from 'path';
import { Client } from '@notionhq/client';
import 'dotenv/config';

// ── Constants ────────────────────────────────────────────────────────────────

const REPORTS_DIR = path.resolve(__dirname, 'reports');
const DATABASE_ID = '72ad5e90-1aec-47c5-b66c-9d54752ef3bd';
const MAX_NOTION_REPORTS = 20;
const MAX_LOCAL_FILES = 5;

// ── Types ────────────────────────────────────────────────────────────────────

type Mode = 'smoke' | 'visual' | 'both';

interface PlaywrightStats {
  startTime: string;
  duration: number;
  expected: number;
  skipped: number;
  unexpected: number;
  flaky: number;
}

interface SmokeReport {
  stats: PlaywrightStats;
  fileName: string;
}

interface AxeSummary {
  routesTested: number;
  totalViolations: number;
  criticalViolations: number;
  seriousViolations: number;
  moderateViolations: number;
  minorViolations: number;
}

interface AxeRouteResult {
  route: string;
  violations: Array<{ id: string; impact: string | null; description: string; nodes: number }>;
  passes: number;
  incomplete: number;
}

interface AxeReport {
  generatedAt: string;
  summary: AxeSummary;
  routes: AxeRouteResult[];
  fileName: string;
}

type Status = 'PASSED' | 'FAILED' | 'PARTIAL';

interface TrendData {
  avgPassRate: number | null;
  avgViolations: number | null;
  avgDuration: number | null;
  prevPassRate: number | null;
  prevViolations: number | null;
  prevDuration: number | null;
  count: number;
}

// ── File helpers ─────────────────────────────────────────────────────────────

function findLatestFile(prefix: string, ext: string): string | null {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const files = fs.readdirSync(REPORTS_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.name ?? null;
}

function findLatestDir(prefix: string): string | null {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const dirs = fs.readdirSync(REPORTS_DIR)
    .filter((f) => {
      if (!f.startsWith(prefix)) return false;
      const stat = fs.statSync(path.join(REPORTS_DIR, f));
      return stat.isDirectory();
    })
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0]?.name ?? null;
}

// ── Report readers ───────────────────────────────────────────────────────────

function readSmokeReport(): SmokeReport | null {
  const fileName = findLatestFile('smoke-', '.json');
  if (!fileName) return null;
  const raw = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, fileName), 'utf-8'));
  return { stats: raw.stats, fileName };
}

function readAxeReport(): AxeReport | null {
  const fileName = findLatestFile('axe-', '.json');
  if (!fileName) return null;
  const raw = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, fileName), 'utf-8'));
  return { ...raw, fileName };
}

// ── Status derivation ────────────────────────────────────────────────────────

function deriveStatus(smoke: SmokeReport | null, axe: AxeReport | null): Status {
  if (smoke && smoke.stats.unexpected > 0) return 'FAILED';
  if (axe && axe.summary.criticalViolations > 0) return 'PARTIAL';
  return 'PASSED';
}

// ── Trend computation ────────────────────────────────────────────────────────

async function computeTrends(notion: Client): Promise<TrendData> {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    sorts: [{ property: 'Run Date', direction: 'descending' }],
    page_size: 10,
  });

  const pages = response.results as Array<Record<string, any>>;
  if (pages.length === 0) {
    return { avgPassRate: null, avgViolations: null, avgDuration: null, prevPassRate: null, prevViolations: null, prevDuration: null, count: 0 };
  }

  const metrics = pages.map((p) => {
    const props = p.properties;
    const expected = props['Tests Expected']?.number ?? 0;
    const passed = props['Tests Passed']?.number ?? 0;
    return {
      passRate: expected > 0 ? (passed / expected) * 100 : 100,
      violations: props['A11y Violations']?.number ?? 0,
      duration: props['Duration (s)']?.number ?? 0,
    };
  });

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    avgPassRate: avg(metrics.map((m) => m.passRate)),
    avgViolations: avg(metrics.map((m) => m.violations)),
    avgDuration: avg(metrics.map((m) => m.duration)),
    prevPassRate: metrics[0].passRate,
    prevViolations: metrics[0].violations,
    prevDuration: metrics[0].duration,
    count: pages.length,
  };
}

function formatTrends(trends: TrendData, currentPassRate: number, currentViolations: number, currentDuration: number): string {
  if (trends.count === 0) return 'First report — no historical data yet.';

  const lines: string[] = [];

  // Pass rate
  if (trends.avgPassRate !== null) {
    const diff = currentPassRate - trends.avgPassRate;
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
    lines.push(`Pass rate: ${currentPassRate.toFixed(1)}% (${arrow} avg ${trends.avgPassRate.toFixed(1)}%)`);
  }

  // Violations
  if (trends.avgViolations !== null) {
    const diff = currentViolations - trends.avgViolations;
    const arrow = diff > 0 ? '↑ worse' : diff < 0 ? '↓ improved' : '→ stable';
    lines.push(`A11y violations: ${currentViolations} (${arrow}, avg ${trends.avgViolations.toFixed(1)})`);
  }

  // Duration
  if (trends.avgDuration !== null) {
    const diff = currentDuration - trends.avgDuration;
    const arrow = diff > 2 ? '↑ slower' : diff < -2 ? '↓ faster' : '→ stable';
    lines.push(`Duration: ${currentDuration.toFixed(1)}s (${arrow}, avg ${trends.avgDuration.toFixed(1)}s)`);
  }

  return lines.join('\n');
}

// ── Skill recommendations ────────────────────────────────────────────────────

function generateRecommendations(smoke: SmokeReport | null, axe: AxeReport | null, trends: TrendData): string {
  const recs: string[] = [];

  if (smoke && smoke.stats.flaky > 0) {
    recs.push(`• ${smoke.stats.flaky} flaky test(s) — investigate timing issues or race conditions`);
  }
  if (smoke && smoke.stats.unexpected > 0) {
    recs.push(`• ${smoke.stats.unexpected} unexpected failure(s) — review test output for regressions`);
  }
  if (axe) {
    if (axe.summary.criticalViolations > 0) {
      recs.push(`• ${axe.summary.criticalViolations} critical a11y violation(s) — fix before deployment (WCAG 2.2 AA)`);
    }
    if (axe.summary.seriousViolations > 0) {
      recs.push(`• ${axe.summary.seriousViolations} serious a11y violation(s) — prioritize in next sprint`);
    }
    if (axe.summary.moderateViolations > 0) {
      recs.push(`• ${axe.summary.moderateViolations} moderate a11y violation(s) — schedule for cleanup`);
    }
  }
  if (trends.avgViolations !== null && axe && axe.summary.totalViolations > trends.avgViolations * 1.5) {
    recs.push('• A11y violations trending upward — review recent UI changes');
  }
  if (trends.avgDuration !== null && smoke && (smoke.stats.duration / 1000) > trends.avgDuration * 1.3) {
    recs.push('• Test duration increasing — check for slow network calls or heavy renders');
  }

  return recs.length > 0 ? recs.join('\n') : 'All clear — no recommendations at this time.';
}

// ── Notion page content ──────────────────────────────────────────────────────

function buildPageContent(smoke: SmokeReport | null, axe: AxeReport | null, mode: Mode, trendsText: string, recommendations: string): string {
  const sections: string[] = [];

  // Test Run Summary
  sections.push('## Test Run Summary');
  if (smoke) {
    const s = smoke.stats;
    sections.push(
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Expected | ${s.expected} |`,
      `| Passed | ${s.expected - s.unexpected - s.skipped} |`,
      `| Failed | ${s.unexpected} |`,
      `| Skipped | ${s.skipped} |`,
      `| Flaky | ${s.flaky} |`,
      `| Duration | ${(s.duration / 1000).toFixed(1)}s |`,
    );
  } else {
    sections.push('*Smoke tests not run in this mode.*');
  }

  // Accessibility
  if (axe) {
    sections.push('', '## Accessibility (WCAG 2.2 AA)');
    const a = axe.summary;
    sections.push(
      `| Impact | Count |`,
      `|--------|-------|`,
      `| Critical | ${a.criticalViolations} |`,
      `| Serious | ${a.seriousViolations} |`,
      `| Moderate | ${a.moderateViolations} |`,
      `| Minor | ${a.minorViolations} |`,
      `| **Total** | **${a.totalViolations}** |`,
      `| Routes tested | ${a.routesTested} |`,
    );

    // Per-route details (only if violations exist)
    const routesWithViolations = axe.routes.filter((r) => r.violations.length > 0);
    if (routesWithViolations.length > 0) {
      sections.push('', '### Per-Route Violations');
      for (const route of routesWithViolations) {
        sections.push(`\n**${route.route}** (${route.violations.length} violations)`);
        for (const v of route.violations) {
          sections.push(`- [${v.impact ?? 'unknown'}] ${v.id}: ${v.description} (${v.nodes} node${v.nodes !== 1 ? 's' : ''})`);
        }
      }
    }
  }

  // Trends
  sections.push('', '## Trends', trendsText);

  // Skill Recommendations
  sections.push('', '## Skill Recommendations', recommendations);

  // Local Artifacts
  sections.push('', '## Local Artifacts');
  if (smoke) sections.push(`- Smoke: \`${smoke.fileName}\``);
  if (axe) sections.push(`- Axe: \`${axe.fileName}\``);

  return sections.join('\n');
}

// ── Notion rotation ──────────────────────────────────────────────────────────

async function rotateNotionReports(notion: Client): Promise<void> {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    sorts: [{ property: 'Run Date', direction: 'ascending' }],
    page_size: 100,
  });

  const pages = response.results;
  const excess = pages.length - MAX_NOTION_REPORTS;
  if (excess <= 0) return;

  // Archive oldest pages beyond the limit
  for (let i = 0; i < excess; i++) {
    await notion.pages.update({ page_id: pages[i].id, archived: true });
  }
}

// ── Local rotation ───────────────────────────────────────────────────────────

function rotateLocalFiles(): void {
  if (!fs.existsSync(REPORTS_DIR)) return;

  // Rotate smoke JSONs
  rotateByPrefix('smoke-', '.json');
  // Rotate axe JSONs
  rotateByPrefix('axe-', '.json');
  // Rotate visual HTML dirs
  rotateVisualDirs();
}

function rotateByPrefix(prefix: string, ext: string): void {
  const files = fs.readdirSync(REPORTS_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files.slice(MAX_LOCAL_FILES)) {
    fs.unlinkSync(path.join(REPORTS_DIR, file.name));
  }
}

function rotateVisualDirs(): void {
  const dirs = fs.readdirSync(REPORTS_DIR)
    .filter((f) => {
      if (!f.startsWith('visual-')) return false;
      return fs.statSync(path.join(REPORTS_DIR, f)).isDirectory();
    })
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const dir of dirs.slice(MAX_LOCAL_FILES)) {
    fs.rmSync(path.join(REPORTS_DIR, dir.name), { recursive: true, force: true });
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────

export async function uploadReport({ mode }: { mode: Mode }): Promise<string> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) throw new Error('NOTION_API_KEY not set');

  const notion = new Client({ auth: apiKey });

  // Read reports based on mode
  const smoke = (mode === 'smoke' || mode === 'both') ? readSmokeReport() : null;
  const axe = (mode === 'visual' || mode === 'both') ? readAxeReport() : null;

  if (!smoke && !axe) {
    throw new Error('No report files found in reports/ directory');
  }

  // Derive metrics
  const status = deriveStatus(smoke, axe);
  const durationSec = smoke ? smoke.stats.duration / 1000 : 0;
  const passRate = smoke
    ? ((smoke.stats.expected - smoke.stats.unexpected - smoke.stats.skipped) / smoke.stats.expected) * 100
    : 100;
  const passed = smoke ? smoke.stats.expected - smoke.stats.unexpected - smoke.stats.skipped : 0;

  // Compute trends from previous reports
  const trends = await computeTrends(notion);
  const trendsText = formatTrends(trends, passRate, axe?.summary.totalViolations ?? 0, durationSec);
  const recommendations = generateRecommendations(smoke, axe, trends);

  // Build page content
  const content = buildPageContent(smoke, axe, mode, trendsText, recommendations);

  // Rotate Notion reports (before creating new)
  await rotateNotionReports(notion);

  // Create the Notion page
  const now = new Date();
  const title = `${mode.charAt(0).toUpperCase() + mode.slice(1)} Report — ${now.toISOString().slice(0, 10)}`;

  const page = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: {
      'Report': { title: [{ text: { content: title } }] },
      'Run Date': { date: { start: now.toISOString() } },
      'Mode': { select: { name: mode } },
      'Status': { select: { name: status } },
      'Tests Expected': { number: smoke?.stats.expected ?? 0 },
      'Tests Passed': { number: passed },
      'Tests Failed': { number: smoke?.stats.unexpected ?? 0 },
      'Tests Skipped': { number: smoke?.stats.skipped ?? 0 },
      'Duration (s)': { number: Math.round(durationSec * 10) / 10 },
      'A11y Violations': { number: axe?.summary.totalViolations ?? 0 },
      'A11y Critical': { number: axe?.summary.criticalViolations ?? 0 },
      'A11y Serious': { number: axe?.summary.seriousViolations ?? 0 },
      'Routes Tested': { number: axe?.summary.routesTested ?? 0 },
      'Smoke File': { rich_text: [{ text: { content: smoke?.fileName ?? 'N/A' } }] },
      'Axe File': { rich_text: [{ text: { content: axe?.fileName ?? 'N/A' } }] },
      'Skill Recommendations': { rich_text: [{ text: { content: recommendations.slice(0, 2000) } }] },
    },
    children: contentToBlocks(content),
  });

  // Rotate local files
  rotateLocalFiles();

  const pageUrl = (page as any).url as string;
  return pageUrl;
}

// ── Markdown → Notion blocks (simplified) ────────────────────────────────────

function contentToBlocks(markdown: string): any[] {
  const blocks: any[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('### ')) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: [{ text: { content: line.slice(4) } }] } });
      i++;
    } else if (line.startsWith('## ')) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: line.slice(3) } }] } });
      i++;
    } else if (line.startsWith('| ') && lines[i + 1]?.startsWith('|--')) {
      // Table: collect header + separator + rows
      const headerCells = line.split('|').filter(Boolean).map((c) => c.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('| ')) {
        rows.push(lines[i].split('|').filter(Boolean).map((c) => c.trim()));
        i++;
      }
      blocks.push({
        object: 'block',
        type: 'table',
        table: {
          table_width: headerCells.length,
          has_column_header: true,
          has_row_header: false,
          children: [
            { type: 'table_row', table_row: { cells: headerCells.map((c) => [{ text: { content: c } }]) } },
            ...rows.map((row) => ({ type: 'table_row', table_row: { cells: row.map((c) => [{ text: { content: c } }]) } })),
          ],
        },
      });
    } else if (line.startsWith('- ')) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: line.slice(2) } }] } });
      i++;
    } else if (line.startsWith('**') && line.endsWith(')')) {
      // Bold route header in per-route section
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: line.replace(/\*\*/g, '') }, annotations: { bold: true } }] } });
      i++;
    } else if (line.startsWith('*') && line.endsWith('*')) {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: line.replace(/\*/g, '') }, annotations: { italic: true } }] } });
      i++;
    } else if (line.trim() === '') {
      i++;
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: line } }] } });
      i++;
    }
  }

  // Notion API limits to 100 blocks per request
  return blocks.slice(0, 100);
}

// ── CLI entry ────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('upload-report.ts')) {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith('--mode='))?.split('=')[1]
    ?? args[args.indexOf('--mode') + 1];
  const mode: Mode = (['smoke', 'visual', 'both'].includes(modeArg ?? '')
    ? (modeArg as Mode)
    : 'both');

  uploadReport({ mode })
    .then((url) => {
      console.log(`\x1b[32m✔\x1b[0m  Report uploaded: ${url}`);
    })
    .catch((err) => {
      console.error(`\x1b[31m✖\x1b[0m  Upload failed: ${String(err)}`);
      process.exit(1);
    });
}
