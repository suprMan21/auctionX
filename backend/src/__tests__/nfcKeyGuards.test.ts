import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

/**
 * S-NFC3.5 static guards. Each one was proven to fire by injecting a
 * violation and watching it go red (see docs/S_NFC3_5_VERIFICATION.md).
 *
 *  1. No code path creates, aliases or imports a KMS key — across backend/src,
 *     backend/scripts, tag-encoder and tag-hq. KMS setup is a documented Boss
 *     action, never code. (A KMS key per tag is the specific anti-pattern.)
 *  2. The backend never references the encoder-only admin root (amended
 *     2026-10-01 by Boss: per-role KMS roots).
 *  3. The backend never reads or writes `nfc_tags.aes_key_enc` (outside
 *     comments and the generated types file), and never `select('*')`s
 *     nfc_tags (which would read it implicitly).
 */

const APP_ROOT = join(__dirname, '..', '..', '..');
const THIS_FILE = relative(APP_ROOT, __filename);

const SKIP_DIRS = new Set(['node_modules', '.venv', 'venv', '__pycache__', 'dist', '.pytest_cache', '.git']);

const walk = (dir: string, exts: readonly string[], out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
};

const filesUnder = (dirs: readonly string[], exts: readonly string[]): string[] =>
  dirs.flatMap((d) => walk(join(APP_ROOT, d), exts));

const scan = (files: string[], pattern: RegExp, ignore: (file: string, line: string) => boolean = () => false) => {
  const hits: string[] = [];
  for (const file of files) {
    const rel = relative(APP_ROOT, file);
    if (rel === THIS_FILE) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (pattern.test(line) && !ignore(rel, line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  return hits;
};

const isComment = (line: string): boolean => /^\s*(\*|\/\/|\/\*|#|--)/.test(line);

describe('KMS keys are never created by code', () => {
  const files = filesUnder(['backend/src', 'backend/scripts', 'tag-encoder', 'tag-hq'], ['.ts', '.js', '.py', '.sh']);

  it('scanned a real number of files (a guard over zero files is a false green)', () => {
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((f) => f.endsWith('kms_key_provider.py'))).toBe(true);
    expect(files.some((f) => f.endsWith('tagKeyProvider.ts'))).toBe(true);
  });

  it('has no CreateKey / CreateAlias / ImportKeyMaterial anywhere', () => {
    const pattern = /CreateKey|CreateAlias|ImportKeyMaterial|create_key|create_alias|import_key_material|GetParametersForImport|get_parameters_for_import/;
    // The Python guard test spells the same patterns to search for them.
    const hits = scan(files, pattern, (rel) => rel.endsWith('tests/test_no_kms_key_creation.py'));
    expect(hits).toEqual([]);
  });
});

describe('the backend cannot reach the encoder-only admin root', () => {
  const files = [
    ...filesUnder(['backend/src', 'backend/scripts'], ['.ts', '.js']).filter((f) => !f.includes('__tests__')),
    ...['backend/.env.op', 'backend/.env.example'].map((f) => join(APP_ROOT, f)).filter(existsSync),
  ];

  it('scanned the backend source', () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it('references no admin alias, admin root config or application-master role', () => {
    const hits = scan(files, /am-tag-admin|NFC_KMS_ADMIN|ADMIN_ROOT|ADMIN_KEY_ID|APP_MASTER/i);
    expect(hits).toEqual([]);
  });
});

describe('aes_key_enc is dead in the backend', () => {
  const files = filesUnder(['backend/src', 'backend/scripts'], ['.ts']).filter(
    (f) => !f.includes('__tests__') && !f.endsWith('database.types.ts'),
  );

  it('is never read or written (comments excepted)', () => {
    expect(scan(files, /aes_key_enc|aesKey/, (_f, line) => isComment(line))).toEqual([]);
  });

  it("never select('*') from nfc_tags", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const re = /\.from\(\s*'nfc_tags'\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const rest = src.slice(m.index);
        const end = rest.indexOf(';');
        const stmt = rest.slice(0, end === -1 ? 400 : end);
        if (/\.select\(\s*(\)|'\*'|`\*`|"\*")/.test(stmt)) offenders.push(`${relative(APP_ROOT, file)} @${m.index}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
