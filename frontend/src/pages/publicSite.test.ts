import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';

/**
 * The public site (authentic-materials.com, `npm run build:public`) ships
 * landing pages only. This walks everything `main.public.tsx` imports and fails
 * if app code is reachable from it, so a later edit cannot quietly put sign-in,
 * admin, payments or a backend URL on the public domain.
 */

const SRC = resolve(__dirname, '..');
const ENTRY = resolve(SRC, 'main.public.tsx');

// Anything under these, or any of these packages, means the app leaked in.
const FORBIDDEN_PATHS = [/\/features\//, /\/lib\/supabase/, /\/lib\/api/, /\/services\//, /\/stores?\//, /\/App\.tsx$/];
const FORBIDDEN_PACKAGES = [/^@supabase\//, /^@stripe\//, /^zustand/, /^axios/];

// Runtime imports only: `import type` is erased at build time.
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

const resolveFile = (from: string, spec: string): string | null => {
  const base = spec.startsWith('@/') ? resolve(SRC, spec.slice(2)) : resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, resolve(base, 'index.tsx'), resolve(base, 'index.ts')]) {
    if (existsSync(candidate) && /\.(tsx?|css)$/.test(candidate)) return candidate;
  }
  return null;
};

const walk = (): { files: string[]; packages: string[] } => {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    if (file.endsWith('.css')) continue;
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      if (spec.startsWith('.') || spec.startsWith('@/')) {
        const resolved = resolveFile(file, spec);
        if (!resolved) throw new Error(`cannot resolve "${spec}" from ${file}`);
        queue.push(resolved);
      } else {
        packages.add(spec);
      }
    }
  }
  return { files: [...files], packages: [...packages] };
};

describe('public site bundle', () => {
  const { files, packages } = walk();

  it('reaches the home page', () => {
    expect(files).toContain(resolve(SRC, 'pages/HomePage.tsx'));
  });

  it('serves /app/open (the staging site links here to open the Creator app)', () => {
    expect(files).toContain(resolve(SRC, 'pages/AppOpenPage.tsx'));
  });

  it('imports no app code', () => {
    const leaked = files.filter((f) => FORBIDDEN_PATHS.some((p) => p.test(f)));
    expect(leaked).toEqual([]);
  });

  it('imports no backend, auth or payment packages', () => {
    const leaked = packages.filter((name) => FORBIDDEN_PACKAGES.some((p) => p.test(name)));
    expect(leaked).toEqual([]);
  });

  // Decisions DB (Locked 2026-10-28): exactly one network call, the early-access signup.
  const NETWORK = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\bWebSocket\b|\bEventSource\b|\bimport\s*\(/;
  const SIGNUP_FILE = resolve(SRC, 'components/home/earlyAccess.ts');
  const SIGNUP_URL = 'https://vw7zy9mkyg.us-east-2.awsapprunner.com/api/v1/early-access';

  it('makes exactly one network call: the early-access signup', () => {
    const callers = files.filter((f) => !f.endsWith('.css') && NETWORK.test(readFileSync(f, 'utf8')));
    expect(callers).toEqual([SIGNUP_FILE]);
    const src = readFileSync(SIGNUP_FILE, 'utf8');
    expect(src.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(src).toContain(`export const EARLY_ACCESS_URL = '${SIGNUP_URL}';`);
    expect(src).toMatch(/fetch\(EARLY_ACCESS_URL,/);
    expect(src).toContain("credentials: 'omit'");
  });

  it('names no other backend address', () => {
    const hosts = files
      .filter((f) => !f.endsWith('.css'))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()));
    const backends = hosts.filter((h) => /awsapprunner|supabase|amazonaws|cloudfront/.test(h));
    expect([...new Set(backends)]).toEqual(['vw7zy9mkyg.us-east-2.awsapprunner.com']);
  });

  it('reads no build-time environment values', () => {
    const readers = files.filter((f) => !f.endsWith('.css') && /import\.meta\.env\.VITE_/.test(readFileSync(f, 'utf8')));
    expect(readers).toEqual([]);
  });
});
