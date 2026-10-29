/**
 * S-SEAL1 Ph2a: give every seal its stored spec once (retired seals too, so history stays drawable).
 *
 * Run (Boss, needs the staging secret key), after the migration is applied:
 *   op run --env-file .env.op -- npx tsx scripts/backfill-seal-specs.ts          # dry run: counts only
 *   op run --env-file .env.op -- npx tsx scripts/backfill-seal-specs.ts --write  # stores the specs
 *
 * Safe to run again: it only touches tags whose seal_spec is still empty, and the column is
 * write-once in the database. Prints counts only (no codes, no tag ids).
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { SEAL_CODE_STORED } from '../src/lib/nfc/sealCode';
import { buildSealSpec } from '../src/lib/seal/sealSpec';

const write = process.argv.includes('--write');
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const main = async () => {
  const { data, error } = await db
    .from('nfc_tags')
    .select('id, seal_code')
    .is('seal_spec', null)
    .not('seal_code', 'is', null);
  if (error) throw new Error(`read failed: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; seal_code: string }>;
  const bad = rows.filter((r) => !SEAL_CODE_STORED.test(r.seal_code)).length;
  console.log(`tags without a spec: ${rows.length} (malformed codes skipped: ${bad})`);
  if (!write) {
    console.log('dry run: nothing written. Add --write to store the specs.');
    return;
  }

  let stored = 0;
  let failed = 0;
  for (const r of rows) {
    if (!SEAL_CODE_STORED.test(r.seal_code)) continue;
    const { error: upErr } = await db
      .from('nfc_tags')
      .update({ seal_spec: buildSealSpec(r.seal_code) })
      .eq('id', r.id)
      .is('seal_spec', null);
    if (upErr) failed++;
    else stored++;
  }
  console.log(`stored: ${stored}, failed: ${failed}`);

  const { count } = await db
    .from('nfc_tags')
    .select('id', { count: 'exact', head: true })
    .is('seal_spec', null)
    .not('seal_code', 'is', null);
  console.log(`still without a spec: ${count ?? 'unknown'}`);
  if (failed > 0) process.exitCode = 1;
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
