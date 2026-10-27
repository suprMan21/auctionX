import { useId, useState } from 'react';
import { Button } from '@/components/common/Button';

interface BackupCodesPanelProps {
  readonly codes: readonly string[];
  readonly onDone: () => void;
}

/**
 * Shown exactly once, straight after the codes are made. They are not stored
 * anywhere the app can show again, so "Done" stays off until the person says
 * they saved them.
 */
export const BackupCodesPanel = ({ codes, onDone }: BackupCodesPanelProps) => {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const checkId = useId();
  const text = codes.join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob(
      [`Authentic Materials backup codes\nEach code works once.\n\n${text}\n`],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'authentic-materials-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="backup-codes-heading" className="space-y-4">
      <h3 id="backup-codes-heading" className="text-lg font-semibold text-white">Save your backup codes</h3>
      <p className="text-sm text-gray-300">
        If you lose your phone or security key, a backup code gets you back in. Each code works once.
        This is the only time we can show them, and we can&apos;t reset your account for you without them.
      </p>
      <ol className="grid grid-cols-2 gap-2 rounded-xl bg-dark-700 border border-white/10 p-4 font-mono text-white" aria-label="Backup codes">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ol>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button>
        <Button variant="secondary" onClick={download}>Download</Button>
      </div>
      <p className="sr-only" role="status">{copied ? 'Backup codes copied' : ''}</p>
      <div className="flex items-start gap-3">
        <input
          id={checkId}
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-1 h-5 w-5 rounded border-white/20 bg-dark-700 focus:ring-2 focus:ring-primary-500"
        />
        <label htmlFor={checkId} className="text-sm text-gray-300">
          I saved these codes somewhere safe, like my password manager.
        </label>
      </div>
      <Button onClick={onDone} disabled={!saved}>Done</Button>
    </section>
  );
};
