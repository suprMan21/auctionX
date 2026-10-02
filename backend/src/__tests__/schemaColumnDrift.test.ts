import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards against PostgREST column-name drift in the S-NFC3 surface.
 *
 * WHY THIS EXISTS: `supabase.from('users').select('country')` is a plain string.
 * TypeScript cannot check it, and a hand-rolled test mock answers happily for a
 * column that does not exist — so a wrong name passes tsc, passes vitest, and
 * only fails against the real database.
 *
 * That is not hypothetical. This file was written after exactly two such bugs
 * shipped into S-NFC3 and were caught by reading database.types.ts by hand:
 *   - `users.country`  — no such column (it is `billing_country`, added by
 *                        20260919000002; `country` belongs to another table)
 *   - `users.username` — renamed to `display_name` project-wide in 2026-05-09
 *                        (CLAUDE.md v25.0). The stale `generate_token_name` RPC
 *                        still references `username` and would fail if called.
 *
 * The check is deliberately narrow: literal `.from('<table>')...select('<cols>')`
 * chains in the S-NFC3 modules, validated against `database.types.ts`. It cannot
 * catch everything, but it catches the mistake that actually happened.
 *
 * NOTE: `database.types.ts` must be regenerated after a migration for this to
 * mean anything — a stale types file makes a new column look like drift. When
 * that happens the fix is to regenerate, not to relax this test.
 */

const SRC = join(__dirname, '..');

const TARGET_FILES = [
  'controllers/tagManagementController.ts',
  'controllers/ownershipController.ts',
  'routes/tokenFeeWebhook.ts',
];

/**
 * Columns that are absent from `database.types.ts` but legitimately exist
 * because a migration has been written and not yet applied + regenerated.
 * Use `['*']` for a table the pending migration creates.
 *
 * Empty since S-DB1 (2026-10-01): 20260919000001/2 applied to staging and both
 * types copies regenerated. Add entries only for a migration that is genuinely
 * pending, and remove them at the next regen. Growing it to silence a failure
 * is the wrong move — the point of the test is that a wrong column name fails.
 */
const PENDING_MIGRATION_COLUMNS: Record<string, readonly string[]> = {};

/** Parses `Row: { ... }` blocks out of database.types.ts, keyed by table name. */
const parseKnownColumns = (): Map<string, Set<string>> => {
  const types = readFileSync(join(SRC, 'types/database.types.ts'), 'utf8');
  const byTable = new Map<string, Set<string>>();

  // `      <table>: {` followed eventually by `        Row: {`
  const tableRe = /^ {6}(\w+): \{$/gm;
  let match: RegExpExecArray | null;

  while ((match = tableRe.exec(types)) !== null) {
    const table = match[1];
    const rowStart = types.indexOf('Row: {', match.index);
    if (rowStart === -1) continue;

    const rowEnd = types.indexOf('\n        }', rowStart);
    if (rowEnd === -1) continue;

    const cols = new Set<string>();
    for (const line of types.slice(rowStart, rowEnd).split('\n').slice(1)) {
      const col = /^\s{10}(\w+)\??:/.exec(line);
      if (col) cols.add(col[1]);
    }
    if (cols.size > 0 && !byTable.has(table)) byTable.set(table, cols);
  }

  return byTable;
};

/**
 * Finds `.from('<table>')` followed by `.select('<cols>')` within the same
 * chain. Deliberately simple: it only understands literal, single-line-ish
 * chains, which is how every query in these files is written.
 */
const extractSelects = (source: string): Array<{ table: string; columns: string[] }> => {
  const results: Array<{ table: string; columns: string[] }> = [];
  const fromRe = /\.from\(\s*'([a-z_]+)'\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = fromRe.exec(source)) !== null) {
    const table = match[1];
    // Confine the lookahead to THIS statement — a window that runs past the
    // terminating `;` picks up the next chain's .select() and attributes its
    // columns to the wrong table (which is exactly what the first draft did).
    const rest = source.slice(match.index);
    const statementEnd = rest.indexOf(';');
    const window = rest.slice(0, statementEnd === -1 ? 600 : statementEnd);
    const sel = /\.select\(\s*(?:`([^`]*)`|'([^']*)')\s*\)/.exec(window);
    if (!sel) continue;

    const raw = (sel[1] ?? sel[2] ?? '').trim();
    if (raw === '' || raw === '*') continue;

    const columns = raw
      // Strip template interpolations like `${TAG_COLUMNS}` — resolved separately.
      .replace(/\$\{[^}]*\}/g, '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c !== '' && !c.includes('(') && !c.includes(':'));

    if (columns.length > 0) results.push({ table, columns });
  }

  return results;
};

/** Column lists held in a `const X = '...'` and interpolated into selects. */
const extractColumnConstants = (source: string): string[] => {
  const out: string[] = [];
  const re = /const\s+\w*COLUMNS\w*\s*(?::\s*\w+\s*)?=\s*\n?\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
};

describe('PostgREST column drift (S-NFC3 surface)', () => {
  const known = parseKnownColumns();

  it('parsed the users table out of database.types.ts', () => {
    // Sanity: if this fails the parser is broken and every assertion below is a
    // false green (same shape as "a lint that processed zero files passed").
    const users = known.get('users');
    expect(users).toBeDefined();
    expect(users!.size).toBeGreaterThan(20);
    expect(users!.has('display_name')).toBe(true);
  });

  it('confirms the two columns that actually bit us', () => {
    const users = known.get('users')!;
    // The bugs this file was written for.
    expect(users.has('username')).toBe(false);
    expect(users.has('country')).toBe(false);
  });

  it.each(TARGET_FILES)('uses only real columns in %s', (file) => {
    const source = readFileSync(join(SRC, file), 'utf8');

    const unknown: string[] = [];
    const check = (table: string, columns: string[]) => {
      const cols = known.get(table);
      const pending = PENDING_MIGRATION_COLUMNS[table] ?? [];
      // A table created by this session's migration is exempt wholesale.
      if (pending.includes('*')) return;
      if (!cols) {
        unknown.push(`${table} (table not in database.types.ts)`);
        return;
      }
      for (const col of columns) {
        if (!cols.has(col) && !pending.includes(col)) unknown.push(`${table}.${col}`);
      }
    };

    for (const { table, columns } of extractSelects(source)) check(table, columns);

    // Interpolated column constants, attributed to the table they are used with.
    for (const constant of extractColumnConstants(source)) {
      const columns = constant.split(',').map((c) => c.trim()).filter(Boolean);
      if (/\b(lifecycle_status|tag_uid|sun_counter)\b/.test(constant)) {
        check('nfc_tags', columns);
      }
    }

    expect(unknown).toEqual([]);
  });
});
