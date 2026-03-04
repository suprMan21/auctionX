import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// cwd for all git operations — project root (unmentionables/Unmen/)
const GIT_CWD = path.resolve(__dirname, '../../..');

export interface FileChange {
  path: string;
  content: string;
}

export interface GitResult {
  branch: string | null;
  filesChanged: number;
  commitHash: string | null;
}

function exec(cmd: string, cwd: string = GIT_CWD): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export async function applyChanges(fileChanges: FileChange[], timestamp: string): Promise<GitResult> {
  const branch = `design-review/${timestamp.slice(0, 15).replace(/[T:.]/g, '-').replace(/-+$/, '')}`;

  if (fileChanges.length === 0) {
    console.log('  [git-ops] No file changes from agent — skipping commit');
    return { branch: null, filesChanged: 0, commitHash: null };
  }

  // ── Check git status ───────────────────────────────────────────────────────
  try {
    const status = exec('git status --porcelain');
    if (status.length > 0) {
      console.log('  [git-ops] Warning: working tree is dirty — proceeding anyway');
    }
  } catch {
    console.log('  [git-ops] Warning: could not check git status');
  }

  // ── Create branch ──────────────────────────────────────────────────────────
  try {
    exec(`git checkout -b ${branch}`);
    console.log(`  [git-ops] Created branch: ${branch}`);
  } catch (err) {
    console.log(`  [git-ops] Warning: could not create branch (${String(err)}) — writing files without commit`);
    writeFiles(fileChanges);
    return { branch, filesChanged: fileChanges.length, commitHash: null };
  }

  // ── Write files ────────────────────────────────────────────────────────────
  writeFiles(fileChanges);

  // ── Stage + commit ─────────────────────────────────────────────────────────
  let commitHash: string | null = null;
  try {
    const filePaths = fileChanges.map((f) => `"${f.path}"`).join(' ');
    exec(`git add ${filePaths}`);
    exec(`git commit -m "design-review(agent): AI design improvements ${timestamp.slice(0, 10)}"`);
    commitHash = exec('git rev-parse --short HEAD');
    console.log(`  [git-ops] Committed as ${commitHash}`);
  } catch (err) {
    console.log(`  [git-ops] Warning: commit failed (${String(err)}) — files written but not committed`);
  }

  return { branch, filesChanged: fileChanges.length, commitHash };
}

function writeFiles(fileChanges: FileChange[]): void {
  for (const change of fileChanges) {
    const absPath = path.resolve(GIT_CWD, change.path);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, change.content, 'utf-8');
    console.log(`  [git-ops] Wrote: ${change.path}`);
  }
}
