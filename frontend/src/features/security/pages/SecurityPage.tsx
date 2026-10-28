/**
 * /settings/security (S-2FA Ph2): passkeys (add, rename, remove), the
 * authenticator app, and backup codes. Every change after the first method
 * needs a fresh "Confirm it's you"; the last method can never be removed.
 */

import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button } from '@/components/common/Button';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { mfaApi, type Passkey, type StepUpAction } from '../api/mfaApi';
import { sessionKeyOf, useMfaStore } from '../store/mfaStore';
import { useStepUpDialog } from '../components/StepUpDialog';
import { AddPasskeyFlow } from '../components/AddPasskeyFlow';
import { AuthenticatorAppSetup } from '../components/AuthenticatorAppSetup';
import { BackupCodesPanel } from '../components/BackupCodesPanel';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { EmailCodeForm } from '../components/EmailCodeForm';
import type { CodeSent } from '../api/mfaApi';
import { mfaErrorCopy } from '../lib/copy';
import { isWaiting, secondFactorPathFor } from '../lib/stepUp';

type Open = null | 'add_passkey' | 'totp' | { codes: string[] };

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const signedOut = (ended: boolean | undefined) => (ended ? ' Your other devices were signed out.' : '');
const timeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtTime = (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : '');
const fmt = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : null);

export const SecurityPage = () => {
  const { session } = useAuth();
  const { status, state, ensure, refresh } = useMfaStore();
  const { confirm, dialog } = useStepUpDialog();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) void ensure(sessionKeyOf(session.access_token, session.user.id));
  }, [session, ensure]);

  const stepUp = (action: StepUpAction, targetId: string, purpose: string) => confirm({ action, targetId, purpose });

  const done = async (message?: string) => {
    setOpen(null);
    await refresh();
    if (message) toast.success(message);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(mfaErrorCopy(err));
    } finally {
      setBusy(false);
    }
  };

  const removePasskey = (p: Passkey) =>
    run(async () => {
      const token = await stepUp('factor_remove', `passkey:${p.id}`, `remove the passkey “${p.nickname}”`);
      if (!token) return;
      const r = await mfaApi.removePasskey(p.id, token);
      await done(`Passkey removed.${signedOut(r.otherSessionsEnded)}`);
    });

  const removeTotp = () =>
    run(async () => {
      const token = await stepUp('factor_remove', 'totp', 'remove your authenticator app');
      if (!token) return;
      const r = await mfaApi.removeTotp(token);
      await done(`Authenticator app removed.${signedOut(r.otherSessionsEnded)}`);
    });

  const cancelRecovery = () =>
    run(async () => {
      await mfaApi.cancelRecovery();
      await done('Recovery cancelled. Change your password and your email password too.');
    });

  const undoRecovery = (recoveryId: string) =>
    run(async () => {
      const token = await stepUp('recovery_undo', recoveryId, 'undo the account recovery');
      if (!token) return;
      const r = await mfaApi.undoRecovery(recoveryId, token);
      await refresh();
      setOpen({ codes: r.backupCodes });
      toast.success(`Recovery undone.${signedOut(r.otherSessionsEnded)}`);
    });

  const newCodes = () =>
    run(async () => {
      const token = await stepUp('recovery_regen', 'recovery_codes', 'make new backup codes');
      if (!token) return;
      const { backupCodes } = await mfaApi.regenerateBackupCodes(token);
      setOpen({ codes: backupCodes });
    });

  if (state === 'error' && !status) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-white mb-4">Security</h1>
        <div className="glass rounded-2xl p-6" role="alert">
          <p className="text-gray-300">We couldn&apos;t load your sign-in settings. Refresh the page to try again.</p>
          <Button className="mt-4" onClick={() => void refresh()}>Try again</Button>
        </div>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-gray-400" role="status">Loading…</p>
      </main>
    );
  }

  const recovery = status.recovery;
  // The session that just finished a recovery adds its one method without a step-up.
  const isFirst = !status.hasFactor || Boolean(recovery?.mustAddMethod);
  const locked = status.hasFactor && !status.sessionVerified;
  const frozen = Boolean(recovery?.freezeEndsAt) && !recovery?.mustAddMethod;
  // Adding a method after the first needs a fresh check of an existing one.
  const addStepUp = (target: 'passkey' | 'totp') => () =>
    stepUp('factor_add', target, target === 'passkey' ? 'add a passkey' : 'add an authenticator app');

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Security</h1>
        <p className="text-gray-400 mt-1">
          {status.hasFactor
            ? 'Two-step sign-in is on. You confirm it is you with a passkey or a code after your password.'
            : 'Add a passkey so a stolen password is not enough to get into your account or move your tokens.'}
        </p>
        {status.breakGlass && (
          <p className="mt-3 text-sm text-amber-200">
            This is the break-glass account. It signs in with a hardware security key only, sessions last 1 hour,
            and every sign-in sends an alert.
          </p>
        )}
      </header>

      {locked && (
        <div className="glass rounded-2xl p-4 border border-amber-400/30" role="status">
          <p className="text-sm text-gray-200">
            Confirm your sign-in on this device before changing anything here.{' '}
            <Link to={secondFactorPathFor('/settings/security')} className="underline text-primary-300">Confirm now</Link>
          </p>
        </div>
      )}

      {recovery?.status === 'holding' && recovery.holdEndsAt && (
        <div className="glass rounded-2xl p-4 border border-red-400/40 space-y-3" role="alert">
          <p className="text-sm text-gray-100">
            Someone started recovering this account by email. They can finish on {fmtTime(recovery.holdEndsAt)}.
            If it wasn&apos;t you, cancel it now, then change your password and your email password.
          </p>
          <Button variant="secondary" onClick={() => void cancelRecovery()} disabled={busy || locked}>Cancel recovery</Button>
        </div>
      )}

      {recovery?.mustAddMethod && (
        <div className="glass rounded-2xl p-4 border border-amber-400/30" role="status">
          <p className="text-sm text-gray-200">
            Your account is recovered. Add a passkey or authenticator app below before {fmtTime(recovery.addMethodBefore)}.
          </p>
        </div>
      )}

      {frozen && recovery?.freezeEndsAt && (
        <div className="glass rounded-2xl p-4 border border-amber-400/30 space-y-3" role="status">
          <p className="text-sm text-gray-200">
            This account was recovered by email. Until {fmtTime(recovery.freezeEndsAt)}, transfers, releases and sign-in
            changes are paused to keep your tokens safe.
          </p>
          {recovery.canUndo && (
            <>
              <p className="text-sm text-gray-400">
                Wasn&apos;t you? Undo it with a passkey or authenticator app you had before. Whatever the recovery added is
                removed and every other device is signed out.
              </p>
              <Button variant="secondary" onClick={() => void undoRecovery(recovery.id)} disabled={busy}>Undo recovery</Button>
            </>
          )}
        </div>
      )}

      {/* Passkeys */}
      <section aria-labelledby="passkeys-heading" className="glass rounded-2xl p-6 space-y-4">
        <h2 id="passkeys-heading" className="text-lg font-semibold text-white">Passkeys</h2>
        <p className="text-sm text-gray-400">
          Face ID, fingerprint, or a security key. The safest way to sign in: it cannot be phished.
        </p>
        {status.passkeys.length > 0 && (
          <ul className="divide-y divide-white/10">
            {status.passkeys.map((p) => (
              <PasskeyRow
                key={p.id}
                passkey={p}
                disabled={busy || locked || frozen}
                canRemove={status.passkeys.length + (status.authenticatorApp ? 1 : 0) > 1}
                onRemove={() => void removePasskey(p)}
                onRenamed={() => void refresh()}
              />
            ))}
          </ul>
        )}
        {open === 'add_passkey' ? (
          <AddPasskeyFlow
            isFirst={isFirst}
            breakGlass={status.breakGlass}
            getStepUpToken={addStepUp('passkey')}
            onFinished={() => void done('Passkey added.')}
            onCancel={() => setOpen(null)}
          />
        ) : (
          <Button variant={status.passkeys.length ? 'secondary' : 'primary'} onClick={() => setOpen('add_passkey')} disabled={busy || locked || frozen}>
            Add a passkey
          </Button>
        )}
      </section>

      {/* Authenticator app (not offered on the break-glass account) */}
      {!status.breakGlass && (
        <section aria-labelledby="totp-heading" className="glass rounded-2xl p-6 space-y-4">
          <h2 id="totp-heading" className="text-lg font-semibold text-white">Authenticator app</h2>
          {status.authenticatorApp ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-300">
                On
                {isWaiting(status.authenticatorAppUsableFrom) && (
                  <span className="block text-xs text-amber-200">
                    Added with a code: approves releases and transfers from {fmtTime(status.authenticatorAppUsableFrom)}.
                  </span>
                )}
              </p>
              <Button
                variant="secondary"
                onClick={() => void removeTotp()}
                disabled={busy || locked || frozen || status.passkeys.length === 0}
                title={status.passkeys.length === 0 ? 'Add a passkey before removing your authenticator app' : undefined}
              >
                Remove
              </Button>
            </div>
          ) : open === 'totp' ? (
            <AuthenticatorAppSetup
              isFirst={isFirst}
              getStepUpToken={addStepUp('totp')}
              onFinished={() => void done('Authenticator app is on.')}
              onCancel={() => setOpen(null)}
            />
          ) : (
            <>
              <p className="text-sm text-gray-400">A backup for when your passkey is not to hand.</p>
              <Button variant="secondary" onClick={() => setOpen('totp')} disabled={busy || locked || frozen}>Set up</Button>
            </>
          )}
        </section>
      )}

      {/* Backup codes */}
      {status.hasFactor && (
        <section aria-labelledby="codes-heading" className="glass rounded-2xl p-6 space-y-4">
          <h2 id="codes-heading" className="text-lg font-semibold text-white">Backup codes</h2>
          {typeof open === 'object' && open !== null ? (
            <BackupCodesPanel codes={open.codes} onDone={() => void done('New backup codes saved. The old ones no longer work.')} />
          ) : (
            <>
              <p className="text-sm text-gray-300">
                {status.backupCodesLeft} of 10 left.{' '}
                {status.backupCodesLeft <= 3 && <span className="text-amber-200">Make a new set soon.</span>}
              </p>
              <p className="text-sm text-gray-400">
                If you lose every passkey{status.breakGlass ? '' : ' and your authenticator app'}, a backup code is the only way back in.
              </p>
              <Button variant="secondary" onClick={() => void newCodes()} disabled={busy || locked || frozen}>
                Make new backup codes
              </Button>
            </>
          )}
        </section>
      )}

      {/* Backup email (Ph3b): a second address for email-code recovery. Not for staff. */}
      {status.hasFactor && !status.isStaff && (
        <BackupEmailSection
          backupEmail={status.backupEmail}
          disabled={busy || locked || frozen}
          confirmStepUp={(purpose) => stepUp('recovery_channel', 'backup_email', purpose)}
          onChanged={(message) => void done(message)}
        />
      )}

      {/* Password: needs the second factor and a one-time permit (S-2FA, review follow-up) */}
      <section aria-labelledby="password-heading" className="glass rounded-2xl p-6 space-y-4">
        <h2 id="password-heading" className="text-lg font-semibold text-white">Password</h2>
        <ChangePasswordForm submitLabel="Change password" onDone={() => toast.success('Password changed.')} />
      </section>

      {dialog}
    </main>
  );
};

interface PasskeyRowProps {
  readonly passkey: Passkey;
  readonly disabled: boolean;
  readonly canRemove: boolean;
  readonly onRemove: () => void;
  readonly onRenamed: () => void;
}

const PasskeyRow = ({ passkey, disabled, canRemove, onRemove, onRenamed }: PasskeyRowProps) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(passkey.nickname);
  const [saving, setSaving] = useState(false);
  const inputId = useId();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === passkey.nickname) { setEditing(false); return; }
    setSaving(true);
    try {
      await mfaApi.renamePasskey(passkey.id, trimmed);
      setEditing(false);
      onRenamed();
    } catch (err) {
      toast.error(mfaErrorCopy(err));
    } finally {
      setSaving(false);
    }
  };

  const added = fmt(passkey.createdAt);
  const used = fmt(passkey.lastUsedAt);

  return (
    <li className="py-3 flex flex-wrap items-center justify-between gap-3">
      {editing ? (
        <form onSubmit={(e) => void save(e)} className="flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="sr-only">Passkey name</label>
          <input
            id={inputId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            autoFocus
            className="rounded-xl bg-dark-700 border border-white/10 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <Button type="submit" size="sm" disabled={saving}>Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setName(passkey.nickname); setEditing(false); }}>Cancel</Button>
        </form>
      ) : (
        <div>
          <p className="text-white">{passkey.nickname}</p>
          <p className="text-xs text-gray-400">
            {passkey.synced ? 'Synced across your devices' : 'This device or key only'}
            {added && ` · Added ${added}`}
            {used && ` · Last used ${used}`}
          </p>
          {isWaiting(passkey.usableFrom) && (
            <p className="text-xs text-amber-200">
              Added with a code: it can sign you in now, and approve releases, transfers and changes from {fmtTime(passkey.usableFrom)}.
            </p>
          )}
        </div>
      )}
      {!editing && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={disabled}>Rename</Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onRemove}
            disabled={disabled || !canRemove}
            title={canRemove ? undefined : 'Add another way to sign in before removing this one'}
          >
            Remove
          </Button>
        </div>
      )}
    </li>
  );
};

interface BackupEmailSectionProps {
  readonly backupEmail: { masked: string; verified: boolean } | null;
  readonly disabled: boolean;
  readonly confirmStepUp: (purpose: string) => Promise<string | null>;
  readonly onChanged: (message: string) => void;
}

const BackupEmailSection = ({ backupEmail, disabled, confirmStepUp, onChanged }: BackupEmailSectionProps) => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(mfaErrorCopy(err));
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    act(async () => {
      const token = await confirmStepUp(backupEmail?.verified ? 'replace your backup email' : 'add a backup email');
      if (!token) return;
      setSent(await mfaApi.addBackupEmail(email.trim(), token));
    });

  const verify = (code: string) =>
    act(async () => {
      if (!sent) return;
      await mfaApi.verifyBackupEmail(sent.codeId, code);
      setSent(null);
      setEmail('');
      onChanged('Backup email confirmed.');
    });

  const remove = () =>
    act(async () => {
      const token = await confirmStepUp('remove your backup email');
      if (!token) return;
      await mfaApi.removeBackupEmail(token);
      onChanged('Backup email removed.');
    });

  return (
    <section aria-labelledby="backup-email-heading" className="glass rounded-2xl p-6 space-y-4">
      <h2 id="backup-email-heading" className="text-lg font-semibold text-white">Backup email</h2>
      <p className="text-sm text-gray-400">
        If you lose every passkey and code, you can recover your account with a code sent to your account email or this
        address. Use one that someone with your main inbox can&apos;t get into.
      </p>
      {backupEmail && !sent && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-300">
            {backupEmail.masked}{' '}
            {!backupEmail.verified && <span className="text-amber-200">(not confirmed: add it again to get a new code)</span>}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void remove()} disabled={disabled || busy}>Remove</Button>
        </div>
      )}
      {sent ? (
        <EmailCodeForm
          sentTo={sent.sentTo}
          busy={busy}
          resendAfter={sent.resendAfter}
          submitLabel="Confirm"
          onSubmit={(c) => void verify(c)}
          onResend={() => void add()}
          onBack={() => { setSent(null); setError(null); }}
        />
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); if (valid) void add(); }}
        >
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor={inputId} className="block text-sm text-gray-300 mb-1">
              {backupEmail?.verified ? 'Replace with' : 'Email address'}
            </label>
            <input
              id={inputId}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled || busy}
              className="w-full rounded-xl bg-dark-700 border border-white/10 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={disabled || busy || !valid} aria-busy={busy}>
            {busy ? 'Sending…' : backupEmail?.verified ? 'Replace' : 'Add'}
          </Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </section>
  );
};
