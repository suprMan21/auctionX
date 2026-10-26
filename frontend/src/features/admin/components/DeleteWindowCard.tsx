/**
 * S-ADMIN2: the waiting window between Retire and Delete (Locked 2026-10-25:
 * default 24 h, super admin may change it, never below 1 h; change audited).
 */

import { useEffect, useId, useState } from 'react';
import { adminApi } from '../api/adminApi';
import type { AccountSettings } from '../api/accountSchemas';
import { AdminDialog, ADMIN_BUTTON_CLASS, ADMIN_FIELD_CLASS } from './AdminDialog';
import { ErrorLine, REASON_MIN, ReasonField } from './AdminTagDialogs';
import { ACTION_FAILED, errorMessage, loadFailed } from '../lib/display';

export const DeleteWindowCard = ({ canEdit }: { canEdit: boolean }) => {
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState('24');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hoursId = useId();

  const load = () =>
    adminApi
      .getAccountSettings()
      .then((s) => { setSettings(s); setLoadError(null); })
      .catch((err: unknown) => setLoadError(errorMessage(err, loadFailed('The waiting time'))));

  useEffect(() => { void load(); }, []);

  const openDialog = () => {
    setHours(String(settings?.deleteWindowHours ?? 24));
    setReason('');
    setError(null);
    setOpen(true);
  };

  const parsed = Number(hours);
  const hoursOk = Number.isInteger(parsed) && parsed >= 1 && parsed <= 8760;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.setDeleteWindow(parsed, reason.trim());
      setOpen(false);
      await load();
    } catch (err) {
      setError(errorMessage(err, ACTION_FAILED));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass rounded-2xl p-5" aria-labelledby="delete-window-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="delete-window-heading" className="text-base font-semibold text-white">Waiting time before deleting</h2>
          <p className="text-sm text-gray-400 mt-1">
            {loadError
              ? loadError
              : settings
                ? `An account can be deleted ${settings.deleteWindowHours} hour${settings.deleteWindowHours === 1 ? '' : 's'} after it is retired.`
                : 'Loading the waiting time…'}
          </p>
        </div>
        {canEdit && settings && (
          <button type="button" onClick={openDialog} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600 min-h-[44px]`}>
            Change waiting time…
          </button>
        )}
      </div>

      <AdminDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Change waiting time before deleting"
        description="Applies to every retired account, including ones already retired. Minimum 1 hour."
      >
        <div className="space-y-1">
          <label htmlFor={hoursId} className="block text-sm font-medium text-gray-200">Hours</label>
          <input
            id={hoursId}
            type="number"
            min={1}
            max={8760}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className={ADMIN_FIELD_CLASS}
          />
        </div>
        <ReasonField value={reason} onChange={setReason} />
        <ErrorLine message={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => setOpen(false)} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`}>
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !hoursOk || reason.trim().length < REASON_MIN}
            className={`${ADMIN_BUTTON_CLASS} bg-primary-600 hover:bg-primary-500 text-white`}
          >
            {busy ? 'Saving…' : 'Save waiting time'}
          </button>
        </div>
      </AdminDialog>
    </section>
  );
};
