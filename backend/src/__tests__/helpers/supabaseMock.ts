/**
 * Minimal in-memory stand-in for the Supabase query builder.
 *
 * Covers exactly the surface the S-NFC3 controllers use:
 *   .from(t).select(cols).eq(c, v).maybeSingle() / .single() / .limit(n)
 *   .from(t).insert(row).select(cols).single()
 *   .from(t).update(patch).eq(c, v)[.eq(...)][.lt(c, v)][.select().maybeSingle()]
 *   S-NFC3-FE: .in(c, values), .is(c, null), .gt(c, v) (tap-session expiry)
 *
 * S-ADMIN1: `.ilike(c, '%suffix')` (suffix match only), `.gte()`, `.lte()`,
 * `.order()`, `.range()`, `select(cols, { count: 'exact' })`, and `.rpc()`
 * answered by the `rpc` hook (database functions cannot run in memory).
 *
 * S-NFC-ID: `.or('a.eq.x,b.eq.y')` (eq terms only), `maybeSingle()` errors on
 * more than one row exactly as PostgREST does (so an ambiguous duplicate-UID
 * lookup cannot pass silently), and nfc_tags inserts enforce the v2 identity
 * indexes (UID unique among v1 rows only; serial and fingerprint unique).
 *
 * S-NFC3.5: `.lt()` (the conditional counter burn) and an optional
 * `beforeUpdate` hook, so a test can play a concurrent request that wins the
 * race between our read and our conditional write.
 *
 * Deliberately NOT a general Supabase emulator. It exists so the lifecycle
 * rules — claim only on ENROLLED, completion only via webhook, pending
 * transfers locking release — can be tested as behaviour rather than asserted
 * by reading the code. Anything it does not implement throws loudly rather than
 * silently returning empty, so a test can never pass against a query the mock
 * quietly ignored.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

interface Filter {
  column: string;
  op: 'eq' | 'lt' | 'gt' | 'gte' | 'lte' | 'in' | 'is' | 'ilike' | 'or' | 'notnull';
  value: unknown;
}

const matches = (row: Row, filters: Filter[]): boolean =>
  filters.every((f) => {
    const cell = row[f.column];
    switch (f.op) {
      case 'eq':
        return cell === f.value;
      case 'or':
        return (f.value as Array<[string, string]>).some(([column, value]) => row[column] === value);
      case 'is':
        // PostgREST `is null`: a missing column reads as null too.
        return (cell ?? null) === f.value;
      case 'notnull':
        return (cell ?? null) !== null;
      case 'in':
        return (f.value as unknown[]).includes(cell);
      // Numbers compare numerically; ISO timestamps compare lexically, which is
      // chronological for same-format UTC strings.
      case 'lt':
        return cell !== null && cell !== undefined && (cell as number) < (f.value as number);
      case 'gt':
        return cell !== null && cell !== undefined && (cell as number) > (f.value as number);
      case 'gte':
        return cell !== null && cell !== undefined && (cell as number) >= (f.value as number);
      case 'lte':
        return cell !== null && cell !== undefined && (cell as number) <= (f.value as number);
      case 'ilike': {
        // Only the leading-wildcard suffix form the admin search uses.
        const pattern = String(f.value);
        if (!pattern.startsWith('%') || pattern.slice(1).includes('%')) {
          throw new Error(`supabaseMock: unsupported ilike pattern ${pattern}`);
        }
        return typeof cell === 'string' && cell.toUpperCase().endsWith(pattern.slice(1).toUpperCase());
      }
    }
  });

export interface MockHooks {
  /** Runs immediately before an update is applied (after filters are set). */
  beforeUpdate?: (table: string, patch: Row) => void;
  /** Return true to make a read on `table` fail like a PostgREST error. */
  failRead?: (table: string) => boolean;
  /**
   * Return true to make an update on `table` fail like a PostgREST error (e.g.
   * a CHECK violation), leaving the rows untouched.
   */
  failUpdate?: (table: string, patch: Row) => boolean;
  /**
   * Answers `.rpc(fn, args)`. Without it an rpc call throws, so a test can never
   * pass against a database function the mock silently ignored.
   */
  rpc?: (fn: string, args: Row) => { data: unknown; error: { message: string } | null };
}

let idCounter = 0;
const nextId = (): string => {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
};

export const resetMockIds = (): void => {
  idCounter = 0;
};

class QueryBuilder {
  private filters: Filter[] = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private patch: Row = {};
  private inserted: Row | null = null;
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  /** Set once a terminal .select() follows an insert/update. */
  private wantsRows = false;

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
    private readonly hooks: MockHooks = {},
  ) {
    if (!this.tables[table]) this.tables[table] = [];
  }

  select(_cols?: string, _opts?: { count?: string }): this {
    if (this.mode === 'select') this.wantsRows = true;
    else this.wantsRows = true;
    return this;
  }

  insert(row: Row): this {
    this.mode = 'insert';
    this.inserted = { id: nextId(), ...row };
    return this;
  }

  update(patch: Row): this {
    this.mode = 'update';
    this.patch = patch;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lt', value });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gt', value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ column, op: 'in', value: values });
    return this;
  }

  or(expr: string): this {
    const terms = expr.split(',').map((term) => {
      const m = /^([a-z0-9_]+)\.eq\.(.+)$/.exec(term);
      if (!m) throw new Error(`supabaseMock: unsupported or() term ${term}`);
      return [m[1], m[2]] as [string, string];
    });
    this.filters.push({ column: '', op: 'or', value: terms });
    return this;
  }

  is(column: string, value: null): this {
    this.filters.push({ column, op: 'is', value });
    return this;
  }

  /** Only the `not(col, 'is', null)` form (IS NOT NULL). */
  not(column: string, operator: string, value: unknown): this {
    if (operator !== 'is' || value !== null) {
      throw new Error(`supabaseMock: unsupported not(${column}, ${operator}, ${String(value)})`);
    }
    this.filters.push({ column, op: 'notnull', value: null });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gte', value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lte', value });
    return this;
  }

  ilike(column: string, value: string): this {
    this.filters.push({ column, op: 'ilike', value });
    return this;
  }

  order(column: string, opts: { ascending?: boolean } = {}): this {
    this.orderBy = { column, ascending: opts.ascending ?? true };
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  private apply(): { data: Row[] | null; error: { message: string; code?: string } | null; count?: number } {
    const rows = this.tables[this.table];

    if (this.mode === 'insert') {
      const row = this.inserted as Row;

      // Emulate the partial unique indexes the migration actually creates —
      // without them a race-condition test would pass for the wrong reason.
      if (this.table === 'ownership_transfers' && row.status === 'PENDING') {
        if (rows.some((r) => r.tag_id === row.tag_id && r.status === 'PENDING')) {
          return { data: null, error: { message: 'duplicate pending transfer' } };
        }
      }
      if (this.table === 'ownership_proofs' && row.status === 'current') {
        if (rows.some((r) => r.tag_id === row.tag_id && r.status === 'current')) {
          return { data: null, error: { message: 'duplicate current proof' } };
        }
      }
      if (this.table === 'reissue_requests' && row.status === 'PENDING') {
        // idx_reissue_requests_one_open (S-NFC3) and _one_open_per_tag (S-ADMIN1 Ph2).
        const open = (r: Row) => r.status === 'PENDING' || (r.status === 'APPROVED' && (r.fulfilled_at ?? null) === null);
        if (rows.some((r) => r.tag_id === row.tag_id && open(r))) {
          return { data: null, error: { message: 'duplicate open reissue request', code: '23505' } };
        }
      }
      if (this.table === 'nfc_tap_sessions') {
        if (rows.some((r) => r.token_hash === row.token_hash)) {
          return { data: null, error: { message: 'duplicate token_hash' } };
        }
      }
      if (this.table === 'nfc_tags') {
        const v1 = (r: Row) => (r.chip_serial ?? null) === null;
        if (v1(row) && rows.some((r) => v1(r) && r.tag_uid === row.tag_uid)) {
          return { data: null, error: { message: 'duplicate tag_uid' } };
        }
        if (row.chip_serial && rows.some((r) => r.chip_serial === row.chip_serial)) {
          return { data: null, error: { message: 'duplicate chip_serial' } };
        }
        if (row.originality_sig_sha256 && rows.some((r) => r.originality_sig_sha256 === row.originality_sig_sha256)) {
          return { data: null, error: { message: 'duplicate originality_sig_sha256' } };
        }
      }

      rows.push(row);
      return { data: [row], error: null };
    }

    if (this.mode === 'update') this.hooks.beforeUpdate?.(this.table, this.patch);

    if (this.mode === 'update' && this.hooks.failUpdate?.(this.table, this.patch)) {
      return { data: null, error: { message: 'simulated update failure' } };
    }

    if (this.mode !== 'update' && this.hooks.failRead?.(this.table)) {
      return { data: null, error: { message: 'simulated read failure' } };
    }

    const hits = rows.filter((r) => matches(r, this.filters));

    if (this.mode === 'update') {
      for (const row of hits) Object.assign(row, this.patch);
      return { data: hits, error: null };
    }

    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      hits.sort((a, b) => {
        const x = a[column] as string | number | null | undefined;
        const y = b[column] as string | number | null | undefined;
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (x < y ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    const count = hits.length;
    let out = hits;
    if (this.rangeFrom !== null && this.rangeTo !== null) out = out.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return { data: out, error: null, count };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: unknown }> {
    const { data, error } = this.apply();
    if (!error && data && data.length > 1) {
      return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
    }
    return { data: data && data.length > 0 ? data[0] : null, error };
  }

  async single(): Promise<{ data: Row | null; error: unknown }> {
    const { data, error } = this.apply();
    if (error) return { data: null, error };
    if (!data || data.length === 0) return { data: null, error: { message: 'no rows' } };
    return { data: data[0], error: null };
  }

  /** Thenable, so `await supabase.from(t).update(p).eq(c, v)` works with no terminal. */
  then<TResult1 = { data: Row[] | null; error: unknown }>(
    onfulfilled?: ((value: { data: Row[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
  ): Promise<TResult1> {
    return Promise.resolve(this.apply()).then(onfulfilled as never);
  }
}

export const createMockSupabase = (tables: Tables, hooks: MockHooks = {}) => ({
  from: (table: string) => new QueryBuilder(tables, table, hooks),
  rpc: async (fn: string, args: Row) => {
    if (!hooks.rpc) throw new Error(`supabaseMock: rpc('${fn}') called with no rpc hook`);
    return hooks.rpc(fn, args);
  },
});

export type MockSupabase = ReturnType<typeof createMockSupabase>;
