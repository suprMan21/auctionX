import { useId, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { ReleaseResult } from '../api/schemas';
import { releaseErrorCopy } from '../lib/copy';

export const RELEASE_PHRASE = 'RELEASE';

interface ReleaseTokenDialogProps {
  readonly isOpen: boolean;
  readonly tagId: string;
  readonly onClose: () => void;
  readonly onReleased: (result: ReleaseResult) => void;
}

type Step =
  | { kind: 'warning' }
  | { kind: 'confirm' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string };

/**
 * Release is terminal: the token dies and nobody can claim it again. Three
 * deliberate acts: read the warning, continue, type RELEASE. The phrase is
 * re-checked on submit, so Enter in the field cannot skip it.
 */
export const ReleaseTokenDialog = ({ isOpen, tagId, onClose, onReleased }: ReleaseTokenDialogProps) => {
  const [step, setStep] = useState<Step>({ kind: 'warning' });
  const [phrase, setPhrase] = useState('');
  const phraseId = useId();
  const phraseHelpId = useId();

  const submitting = step.kind === 'submitting';
  const phraseMatches = phrase === RELEASE_PHRASE;

  const close = () => {
    if (submitting) return;
    setStep({ kind: 'warning' });
    setPhrase('');
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !phraseMatches) return;
    setStep({ kind: 'submitting' });
    try {
      const result = await tokenApi.release(tagId);
      setPhrase('');
      setStep({ kind: 'warning' });
      onReleased(result);
    } catch (err) {
      const apiError = err instanceof TokenApiError ? err : null;
      setStep({
        kind: 'error',
        message: releaseErrorCopy(apiError?.reason ?? null, apiError?.message ?? 'Something went wrong. Please try again.'),
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Release this token?">
      {step.kind === 'warning' && (
        <div className="space-y-4">
          <p className="text-white font-semibold">This cannot be undone.</p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-gray-300">
            <li>The token stops being valid. Every future tap shows it as released.</li>
            <li>Nobody can claim it again, including you.</li>
            <li>Release is not a way to give the item away. To pass it on, start a transfer instead.</li>
          </ul>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setStep({ kind: 'confirm' })}>
              I understand, continue
            </Button>
            <Button onClick={close}>Keep my token</Button>
          </div>
        </div>
      )}

      {step.kind !== 'warning' && (
        <form onSubmit={submit} className="space-y-4">
          <label htmlFor={phraseId} className="block text-sm text-gray-300">
            Type <span className="font-mono text-white">{RELEASE_PHRASE}</span> to release this token forever.
          </label>
          <input
            id={phraseId}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby={phraseHelpId}
            disabled={submitting}
            className="w-full rounded-xl bg-dark-700 border border-white/10 px-4 py-3 font-mono text-white focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <p id={phraseHelpId} className="text-gray-400 text-xs">
            Capital letters, exactly as shown.
          </p>

          {step.kind === 'error' && (
            <p role="alert" className="text-red-300 text-sm">
              {step.message}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={!phraseMatches || submitting}
              aria-busy={submitting}
              className="min-h-[44px] px-6 py-3 rounded-btn font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-dark-800"
            >
              {submitting ? 'Releasing…' : 'Release forever'}
            </button>
            <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
              Keep my token
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
