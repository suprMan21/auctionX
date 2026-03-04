import path from 'path';
import fs from 'fs';
import { applyChanges, type FileChange } from './git-ops';
import { updateSuggestions } from './suggestions';

const FRONTEND_SRC = path.resolve(__dirname, '../../frontend/src');
const REPORT_DIR = path.resolve(__dirname, '../reports');
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'screenshots');
const DESIGN_BRIEF_PATH = path.resolve(__dirname, '../../../marketing/DESIGN_BRIEF.md');
const DESIGN_SYSTEM_FALLBACK = path.resolve(__dirname, '../../docs/DESIGN_SYSTEM.md');

function readLatestAxeReport(): Record<string, unknown> | null {
  if (!fs.existsSync(REPORT_DIR)) return null;
  const axeFiles = fs.readdirSync(REPORT_DIR)
    .filter((f) => f.startsWith('axe-') && f.endsWith('.json'))
    .map((f) => ({ f, t: fs.statSync(path.join(REPORT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (axeFiles.length === 0) return null;
  try { return JSON.parse(fs.readFileSync(path.join(REPORT_DIR, axeFiles[0].f), 'utf-8')); }
  catch { return null; }
}

function walkDir(dir: string, exts: string[], maxFiles: number): string[] {
  const results: string[] = [];
  function walk(current: string) {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.git', '__tests__'].includes(entry.name))
          walk(path.join(current, entry.name));
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        results.push(path.join(current, entry.name));
      }
    }
  }
  walk(dir);
  return results.slice(0, maxFiles);
}

function readFileWithLimit(filePath: string, maxLines = 300): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    return lines.length > maxLines
      ? lines.slice(0, maxLines).join('\n') + `\n... [truncated at ${maxLines} lines]`
      : content;
  } catch { return ''; }
}

function encodeScreenshots(max = 3): Array<{ name: string; base64: string; mediaType: string }> {
  if (!fs.existsSync(SCREENSHOT_DIR)) return [];
  return fs.readdirSync(SCREENSHOT_DIR)
    .filter((f) => f.endsWith('.png'))
    .slice(0, max)
    .map((f) => ({
      name: f,
      base64: fs.readFileSync(path.join(SCREENSHOT_DIR, f)).toString('base64'),
      mediaType: 'image/png',
    }));
}

function readDesignBrief(): string {
  if (fs.existsSync(DESIGN_BRIEF_PATH)) return fs.readFileSync(DESIGN_BRIEF_PATH, 'utf-8');
  if (fs.existsSync(DESIGN_SYSTEM_FALLBACK)) {
    console.log('  [agent] DESIGN_BRIEF.md not found, using DESIGN_SYSTEM.md fallback');
    return fs.readFileSync(DESIGN_SYSTEM_FALLBACK, 'utf-8');
  }
  console.log('  [agent] No design brief found — proceeding without it');
  return '';
}

async function callClaude(
  axeReport: Record<string, unknown> | null,
  designBrief: string,
  sourceFiles: Array<{ path: string; content: string }>,
  screenshots: Array<{ name: string; base64: string; mediaType: string }>
): Promise<string> {
  const { spawnSync } = await import('child_process');
  const os = await import('os');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auctionx-review-'));
  const screenshotPaths: string[] = [];
  for (const s of screenshots) {
    const dest = path.join(tempDir, s.name);
    fs.writeFileSync(dest, Buffer.from(s.base64, 'base64'));
    screenshotPaths.push(dest);
  }

  const sourceContext = sourceFiles
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  const axeContext = axeReport
    ? `## Accessibility Report (axe-core WCAG 2.2 AA)\n\`\`\`json\n${JSON.stringify(axeReport, null, 2)}\n\`\`\``
    : '## Accessibility Report\nNo axe report available.';

  const screenshotContext = screenshotPaths.length > 0
    ? `## Screenshots (saved to temp files for reference)\n${screenshotPaths.join('\n')}`
    : '## Screenshots\nNone available.';

  const prompt = [
    '# AuctionX Design Review',
    '',
    '## Task',
    'Review the AuctionX staging site source code and accessibility report.',
    'Provide a structured, actionable design review.',
    '',
    '## Design Brief / System',
    designBrief || '(Not available)',
    '',
    axeContext,
    '',
    screenshotContext,
    '',
    '## Frontend Source Files',
    sourceContext,
    '',
    '## Response Format',
    'Write your review in plain markdown with these sections:',
    '',
    '### Overall Assessment',
    '3-4 paragraphs on design health, consistency, and brand alignment.',
    '',
    '### Accessibility',
    'Summary of axe violations and any additional issues spotted in source.',
    '',
    '### High Priority Issues',
    'Numbered list. Each item: issue, affected file(s), recommended fix.',
    '',
    '### Medium Priority Issues',
    'Same format.',
    '',
    '### Low Priority / Nice to Have',
    'Same format.',
    '',
    '### External / Needs Resources',
    'Anything requiring design assets, new fonts, or third-party tools.',
    '',
    'Be specific and reference actual file names and class names where relevant.',
    'Do not suggest changes to business logic or data flow.',
    'Keep dark-mode-only design (bg #13131a, primary purple gradient).',
  ].join('\n');

  const result = spawnSync('claude', ['--print'], {
    input: prompt,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 300_000,
  });

  try { fs.rmSync(tempDir, { recursive: true }); } catch { /* ignore */ }

  if (result.error) throw new Error(`Claude CLI error: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Claude CLI exited ${result.status}: ${result.stderr}`);

  return result.stdout.trim();
}

export async function run(): Promise<void> {
  console.log('\n[agent] Starting design review…');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const readableTimestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

  console.log('  [agent] Reading axe report…');
  const axeReport = readLatestAxeReport();

  console.log('  [agent] Reading design brief…');
  const designBrief = readDesignBrief();

  console.log('  [agent] Collecting source files (max 20)…');
  const filePaths = walkDir(FRONTEND_SRC, ['.tsx', '.ts', '.css'], 20);
  const sourceFiles = filePaths.map((fp) => ({
    path: path.relative(path.resolve(__dirname, '../../..'), fp),
    content: readFileWithLimit(fp, 300),
  }));
  console.log(`  [agent] ${sourceFiles.length} source files collected`);

  console.log('  [agent] Encoding screenshots (max 3)…');
  const screenshots = encodeScreenshots(3);
  console.log(`  [agent] ${screenshots.length} screenshots encoded`);

  console.log('  [agent] Calling Claude CLI…');
  const reviewText = await callClaude(axeReport, designBrief, sourceFiles, screenshots);

  // Append to DESIGN_SUGGESTIONS.md
  const suggestionsPath = path.resolve(__dirname, '../../DESIGN_SUGGESTIONS.md');
  const axeSummary = axeReport
    ? (axeReport['summary'] as Record<string, unknown>)
    : null;
  const axeLine = axeSummary
    ? `Axe violations: ${JSON.stringify(axeSummary)}`
    : 'Axe report: not available';

  const entry = [
    `## Design Review — ${readableTimestamp}`,
    '',
    `_${axeLine}_`,
    `_Source files reviewed: ${sourceFiles.length} | Screenshots: ${screenshots.length}_`,
    '',
    reviewText,
    '',
    '---',
    '',
  ].join('\n');

  if (fs.existsSync(suggestionsPath)) {
    const existing = fs.readFileSync(suggestionsPath, 'utf-8');
    fs.writeFileSync(suggestionsPath, entry + existing, 'utf-8');
  } else {
    fs.writeFileSync(suggestionsPath, `# Design Suggestions\n\n` + entry, 'utf-8');
  }

  console.log('\n[agent] Design review complete.');
  console.log(`  Suggestions written to: DESIGN_SUGGESTIONS.md`);
  console.log(`\n--- Preview ---\n`);
  console.log(reviewText.slice(0, 500) + (reviewText.length > 500 ? '\n...' : ''));
}
