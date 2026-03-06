#!/usr/bin/env tsx
import dotenv from 'dotenv';
dotenv.config();
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith('--mode='))?.split('=')[1]
  ?? args[args.indexOf('--mode') + 1];
const mode: 'smoke' | 'visual' | 'both' = (['smoke', 'visual', 'both'].includes(modeArg ?? '')
  ? (modeArg as 'smoke' | 'visual' | 'both')
  : 'both');

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(msg: string) { process.stdout.write(msg + '\n'); }
function header(msg: string) { log(`\n${c.bold}${c.cyan}${msg}${c.reset}`); }
function ok(msg: string) { log(`${c.green}✔${c.reset}  ${msg}`); }
function fail(msg: string) { log(`${c.red}✖${c.reset}  ${msg}`); }
function warn(msg: string) { log(`${c.yellow}⚠${c.reset}  ${msg}`); }

// ── Run playwright ────────────────────────────────────────────────────────────

type RunResult = { project: string; passed: boolean; durationMs: number };
const results: RunResult[] = [];

function runProject(project: string): RunResult {
  header(`Running ${project} tests…`);
  const start = Date.now();
  let passed = true;

  try {
    execSync(`npx playwright test --project ${project}`, {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env },
    });
  } catch {
    passed = false;
  }

  const durationMs = Date.now() - start;
  return { project, passed, durationMs };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  header('AuctionX Staging Test Suite');
  log(`${c.dim}Mode: ${mode} | ${new Date().toLocaleString()}${c.reset}`);

  if (mode === 'smoke' || mode === 'both') {
    results.push(runProject('smoke'));
  }

  if (mode === 'visual' || mode === 'both') {
    results.push(runProject('visual-public'));
    results.push(runProject('visual-user'));
    results.push(runProject('visual-admin'));
  }

  // ── Summary table ──────────────────────────────────────────────────────────
  header('Results Summary');
  log('┌─────────────────┬────────────┬─────────────┐');
  log('│ Project         │ Status     │ Duration    │');
  log('├─────────────────┼────────────┼─────────────┤');
  for (const r of results) {
    const status = r.passed
      ? `${c.green}PASSED${c.reset}    `
      : `${c.red}FAILED${c.reset}    `;
    const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
    log(`│ ${r.project.padEnd(15)} │ ${status} │ ${dur.padEnd(11)} │`);
  }
  log('└─────────────────┴────────────┴─────────────┘');

  // ── Latest axe report summary ──────────────────────────────────────────────
  if (mode === 'visual' || mode === 'both') {
    const reportDir = path.resolve(__dirname, 'reports');
    const axeFiles = fs.readdirSync(reportDir)
      .filter((f) => f.startsWith('axe-') && f.endsWith('.json'))
      .map((f) => ({ f, t: fs.statSync(path.join(reportDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);

    if (axeFiles.length > 0) {
      const latest = JSON.parse(fs.readFileSync(path.join(reportDir, axeFiles[0].f), 'utf-8'));
      const s = latest.summary;
      log(`\n${c.bold}Accessibility (WCAG 2.2 AA):${c.reset}`);
      log(`  Routes tested: ${s.routesTested}`);
      log(`  Violations:    ${s.totalViolations} total  (${c.red}${s.criticalViolations} critical${c.reset}, ${c.yellow}${s.seriousViolations} serious${c.reset})`);
    }

    log(`\n${c.cyan}Screenshots captured. Run /review-screenshot then /review-rollup for AI design review.${c.reset}`);
  }

  // ── Upload to Notion ────────────────────────────────────────────────────────
  if (process.env.NOTION_API_KEY) {
    header('Uploading report to Notion…');
    try {
      const { uploadReport } = await import('./upload-report');
      const url = await uploadReport({ mode });
      ok(`Report uploaded: ${url}`);
    } catch (err) {
      warn(`Notion upload failed (non-fatal): ${String(err)}`);
    }
  } else {
    log(`${c.dim}NOTION_API_KEY not set — skipping Notion upload.${c.reset}`);
  }

  // ── Exit code ──────────────────────────────────────────────────────────────
  const allPassed = results.every((r) => r.passed);
  if (allPassed) {
    ok('All test projects passed.\n');
  } else {
    fail('One or more test projects failed.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  fail(`Unexpected error: ${String(err)}`);
  process.exit(1);
});
