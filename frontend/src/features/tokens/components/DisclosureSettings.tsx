import { useState } from 'react';
import { Button } from '@/components/common/Button';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import { DISCLOSURE_FIELDS, type DisclosureField, type Provenance } from '../api/schemas';
import { DISCLOSURE_INFO } from '../lib/disclosure';

interface DisclosureSettingsProps {
  readonly tagId: string;
  readonly disclosure: Record<string, boolean>;
  /** The public provenance as the verify page shows it today. */
  readonly provenance: Provenance | null;
  readonly onSaved: (disclosure: Record<string, boolean>) => void;
}

type Save = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

const toFlags = (disclosure: Record<string, boolean>): Record<DisclosureField, boolean> =>
  Object.fromEntries(DISCLOSURE_FIELDS.map((f) => [f, Boolean(disclosure[f])])) as Record<DisclosureField, boolean>;

/**
 * Four switches for what the public verify page shows, with a live preview.
 * A detail appears only if the creator released it AND the owner shows it, so
 * the preview says "if the creator released it" where we cannot know the value.
 */
export const DisclosureSettings = ({ tagId, disclosure, provenance, onSaved }: DisclosureSettingsProps) => {
  const saved = toFlags(disclosure);
  const [draft, setDraft] = useState(saved);
  const [save, setSave] = useState<Save>({ kind: 'idle' });

  const changes = DISCLOSURE_FIELDS.filter((f) => draft[f] !== saved[f]);
  const dirty = changes.length > 0;

  const toggle = (field: DisclosureField) => {
    setDraft((d) => ({ ...d, [field]: !d[field] }));
    setSave({ kind: 'idle' });
  };

  const submit = async () => {
    if (!dirty || save.kind === 'saving') return;
    setSave({ kind: 'saving' });
    try {
      const next = await tokenApi.updateDisclosure(
        tagId,
        Object.fromEntries(changes.map((f) => [f, draft[f]])),
      );
      setSave({ kind: 'saved' });
      onSaved(next);
    } catch (err) {
      setSave({
        kind: 'error',
        message: err instanceof TokenApiError ? err.message : 'Something went wrong. Please try again.',
      });
    }
  };

  const previewValue = (field: DisclosureField): string => {
    if (!draft[field]) return 'Hidden';
    const value = provenance ? DISCLOSURE_INFO[field].value(provenance) : null;
    return value ?? 'Shown if the creator released it';
  };

  return (
    <section aria-labelledby="disclosure-heading" className="glass rounded-2xl p-6">
      <h2 id="disclosure-heading" className="text-lg font-semibold text-white mb-1">
        What the public page shows
      </h2>
      <p className="text-gray-400 text-sm mb-4">
        Anyone who taps this token sees the details you switch on. Your name and account are never shown.
      </p>

      <ul className="space-y-2 mb-5">
        {DISCLOSURE_FIELDS.map((field) => (
          <li key={field} className="flex items-center justify-between gap-4">
            <span id={`disclosure-${field}`} className="text-gray-300 text-sm">
              {DISCLOSURE_INFO[field].label}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={draft[field]}
              aria-labelledby={`disclosure-${field}`}
              onClick={() => toggle(field)}
              disabled={save.kind === 'saving'}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 ${
                draft[field] ? 'bg-primary-600' : 'bg-dark-700'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                  draft[field] ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-white/10 p-4 mb-5" aria-live="polite">
        <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Preview of the public page</p>
        <dl className="text-sm space-y-1">
          {DISCLOSURE_FIELDS.map((field) => (
            <div key={field} className="flex justify-between gap-4">
              <dt className="text-gray-400">{DISCLOSURE_INFO[field].label}</dt>
              <dd className={draft[field] ? 'text-white text-right' : 'text-gray-500 text-right'}>{previewValue(field)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={submit} disabled={!dirty || save.kind === 'saving'} aria-busy={save.kind === 'saving'}>
          {save.kind === 'saving' ? 'Saving…' : 'Save changes'}
        </Button>
        {dirty && save.kind !== 'saving' && (
          <Button variant="ghost" onClick={() => setDraft(saved)}>
            Undo
          </Button>
        )}
        <span role="status" className="text-sm text-emerald-300">
          {save.kind === 'saved' ? 'Saved.' : ''}
        </span>
      </div>
      {save.kind === 'error' && (
        <p role="alert" className="text-red-300 text-sm mt-3">
          {save.message}
        </p>
      )}
    </section>
  );
};
