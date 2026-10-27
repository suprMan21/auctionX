/* Live check of the Supabase MfaStore against staging (S-2FA Ph1). Throwaway account, deleted at the end (cascade).
 * Run (Boss, needs the staging secret key): op run --env-file .env.op -- npx tsx scripts/mfa-store-smoke.ts
 * Expect: {"cleanup":"ok","leftoverCodes":0} then {"ok":30,"total":30,"failed":[]} */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseMfaStore } from '../src/lib/mfa/store';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const store = createSupabaseMfaStore(db);
const U = 'a2fa2fa2-0000-4000-8000-0000000051e0';
const S = 'a2fa2fa2-0000-4000-8000-0000000051e1';
const results: Record<string, boolean> = {};
const check = (name: string, ok: boolean) => { results[name] = ok; };
const hex = (c: string) => c.repeat(64).slice(0, 64);

(async () => {
  const { error: ue } = await db.from('users').insert({ id: U, email: 's2fa-smoke@example.invalid' });
  if (ue) throw new Error('setup: ' + ue.message);
  try {
    const now = () => new Date().toISOString();
    const pk = (await store.insertPasskey({ user_id: U, credential_id: 'SMOKESMOKESMOKESMOKE', public_key: 'pk', sign_count: 3, transports: ['usb'], aaguid: null, backed_up: false, nickname: 'Key' }))!;
    check('passkey insert+list', (await store.listPasskeys(U)).length === 1);
    check('passkey by credential', (await store.getPasskeyByCredentialId('SMOKESMOKESMOKESMOKE'))?.id === pk.id);
    await store.recordPasskeyUse(pk.id, 2); // lower count: no change
    check('counter never goes down', (await store.listPasskeys(U))[0].sign_count === 3);
    await store.recordPasskeyUse(pk.id, 7);
    check('counter goes up', (await store.listPasskeys(U))[0].sign_count === 7);
    check('rename', await store.renamePasskey(U, pk.id, 'Renamed'));
    check('rename other user refused', !(await store.renamePasskey(S, pk.id, 'x')));

    check('totp start', await store.startTotp(U, 'v1.a.b.c'));
    check('totp restart while pending', await store.startTotp(U, 'v1.d.e.f'));
    check('totp sign-in step refused before confirm', !(await store.useTotpStep(U, 10, false)));
    check('totp confirm', await store.useTotpStep(U, 10, true));
    check('totp start refused once confirmed', !(await store.startTotp(U, 'v1.g.h.i')));
    check('totp same step refused', !(await store.useTotpStep(U, 10, false)));
    check('totp newer step ok', await store.useTotpStep(U, 11, false));

    await store.replaceRecoveryCodes(U, Array.from({ length: 10 }, (_, i) => hex(String(i))));
    check('codes count 10', (await store.countRecoveryCodes(U)) === 10);
    check('code use returns 9', (await store.useRecoveryCode(U, hex('3'))) === 9);
    check('code reuse null', (await store.useRecoveryCode(U, hex('3'))) === null);

    const cid = await store.createChallenge({ user_id: U, session_id: S, purpose: 'sign_in', challenge: 'c', action: null, target_id: null, expires_at: new Date(Date.now() + 60_000).toISOString() });
    check('challenge wrong purpose', (await store.consumeChallenge(cid, U, S, 'register', now())) === null);
    check('challenge consume', (await store.consumeChallenge(cid, U, S, 'sign_in', now()))?.challenge === 'c');
    check('challenge reuse', (await store.consumeChallenge(cid, U, S, 'sign_in', now())) === null);

    await store.markSession({ session_id: S, user_id: U, method: 'passkey', expires_at: new Date(Date.now() + 60_000).toISOString() });
    await store.markSession({ session_id: S, user_id: U, method: 'totp', expires_at: new Date(Date.now() + 60_000).toISOString() });
    check('session upsert', (await store.getSession(S, U, now()))?.method === 'totp');

    await store.createGrant({ token_hash: hex('f'), user_id: U, session_id: S, action: 'release', target_id: 't1', expires_at: new Date(Date.now() + 60_000).toISOString() });
    check('grant wrong target', !(await store.consumeGrant(hex('f'), U, S, 'release', 't2', now())));
    check('grant consume', await store.consumeGrant(hex('f'), U, S, 'release', 't1', now()));
    check('grant reuse', !(await store.consumeGrant(hex('f'), U, S, 'release', 't1', now())));

    for (let i = 0; i < 5; i++) await store.beginCodeAttempt(U);
    const sixth = await store.beginCodeAttempt(U);
    check('lock on the 6th attempt', sixth.newlyLocked && (await store.lockedUntil(U, now())) !== null);
    await store.clearFailures(U);
    check('clear failures', (await store.lockedUntil(U, now())) === null);

    check('staff role (not staff)', (await store.staffRole(U)) === null);
    check('staff role (super_admin)', (await store.staffRole('2b3f1532-9345-4720-8fac-55d07517c78b')) === 'super_admin');

    check('duplicate credential → null', (await store.insertPasskey({ user_id: U, credential_id: 'SMOKESMOKESMOKESMOKE', public_key: 'pk', sign_count: 0, transports: [], aaguid: null, backed_up: false, nickname: 'Dup' })) === null);
    check('remove totp (2 → 1)', (await store.removeFactor(U, 'totp', null, false)) === 'removed');
    check('remove last passkey refused', (await store.removeFactor(U, 'passkey', pk.id, false)) === 'last_factor');
  } finally {
    const { error } = await db.from('users').delete().eq('id', U);
    const { count } = await db.from('user_recovery_codes').select('id', { count: 'exact', head: true }).eq('user_id', U);
    console.log(JSON.stringify({ cleanup: error ? error.message : 'ok', leftoverCodes: count }));
  }
  const failed = Object.entries(results).filter(([, ok]) => !ok).map(([k]) => k);
  console.log(JSON.stringify({ ok: Object.keys(results).length - failed.length, total: Object.keys(results).length, failed }));
})().catch((e) => { console.error('SMOKE ERROR', e instanceof Error ? e.message : e); process.exit(1); });
