/**
 * Minimal in-memory stand-in for the Supabase query builder.
 *
 * Covers exactly the surface the S-NFC3 controllers use:
 *   .from(t).select(cols).eq(c, v).maybeSingle() / .single() / .limit(n)
 *   .from(t).insert(row).select(cols).single()
 *   .from(t).update(patch).eq(c, v)[.eq(...)][.lt(c, v)][.select().maybeSingle()]
 *   S-NFC3-FE: .in(c, values), .is(c, null), .gt(c, v) (tap-session expiry)
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
  op: 'eq' | 'lt' | 'gt' | 'in' | 'is';
  value: unknown;
}

const matches = (row: Row, filters: Filter[]): boolean =>
  filters.every((f) => {
    const cell = row[f.column];
    switch (f.op) {
      case 'eq':
        return cell === f.value;
      case 'is':
        // PostgREST `is null`: a missing column reads as null too.
        return (cell ?? null) === f.value;
      case 'in':
        return (f.value as unknown[]).includes(cell);
      // Numbers compare numerically; ISO timestamps compare lexically, which is
      // chronological for same-format UTC strings.
      case 'lt':
        return cell !== null && cell !== undefined && (cell as number) < (f.value as number);
      case 'gt':
        return cell !== null && cell !== undefined && (cell as number) > (f.value as number);
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
  /** Set once a terminal .select() follows an insert/update. */
  private wantsRows = false;

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
    private readonly hooks: MockHooks = {},
  ) {
    if (!this.tables[table]) this.tables[table] = [];
  }

  select(_cols?: string): this {
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

  is(column: string, value: null): this {
    this.filters.push({ column, op: 'is', value });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private apply(): { data: Row[] | null; error: { message: string } | null } {
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
        if (rows.some((r) => r.tag_id === row.tag_id && r.requester_id === row.requester_id && r.status === 'PENDING')) {
          return { data: null, error: { message: 'duplicate open reissue request' } };
        }
      }
      if (this.table === 'nfc_tap_sessions') {
        if (rows.some((r) => r.token_hash === row.token_hash)) {
          return { data: null, error: { message: 'duplicate token_hash' } };
        }
      }
      if (this.table === 'nfc_tags') {
        if (rows.some((r) => r.tag_uid === row.tag_uid)) {
          return { data: null, error: { message: 'duplicate tag_uid' } };
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

    return { data: this.limitN === null ? hits : hits.slice(0, this.limitN), error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: unknown }> {
    const { data, error } = this.apply();
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
});

export type MockSupabase = ReturnType<typeof createMockSupabase>;
