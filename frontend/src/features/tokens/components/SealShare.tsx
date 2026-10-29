import { useRef, useState } from 'react';
import { Button } from '@/components/common/Button';
import { isSealCode } from '@/components/seal/sealCode';
import { tokenApi } from '../api/tokenApi';
import { showsSeal } from '../lib/sealWindow';
import { SHARE_COPY } from '../lib/copy';
import { sealPageUrl } from '../lib/sealLink';

interface SealShareProps {
  readonly tagId: string;
  /** XXXX-XXXX. Nothing is shown without a well-formed code. */
  readonly sealCode: string | null | undefined;
  readonly lifecycleStatus: string | null;
  /** Small buttons and no explainer line (My Seals cards). */
  readonly compact?: boolean;
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done' | 'error' | 'again'; message: string };

const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';
const isNotAllowed = (err: unknown): boolean => err instanceof DOMException && err.name === 'NotAllowedError';

const download = (file: File) => {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/**
 * Share link / Share picture for the current owner of a live seal (S-SEAL1 Ph2b).
 * Two separate buttons: a link and a file are never shared together.
 *
 * Share link uses the phone's share sheet, else copies the link. Share picture fetches the
 * owner's PNG and shares it as a file, else downloads it. Safari can refuse the share sheet
 * after a network wait; the picture is then kept and one more tap shares it.
 */
export const SealShare = ({ tagId, sealCode, lifecycleStatus, compact = false }: SealShareProps) => {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const picture = useRef<File | null>(null);

  if (!isSealCode(sealCode) || !showsSeal(lifecycleStatus)) return null;
  const code = sealCode;
  const url = sealPageUrl(code);

  const shareLink = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, title: `${SHARE_COPY.titlePrefix} ${code}` });
        setStatus({ kind: 'idle' });
        return;
      } catch (err) {
        if (isAbort(err)) return;
        // Fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus({ kind: 'done', message: SHARE_COPY.linkCopied });
    } catch {
      setStatus({ kind: 'error', message: `${SHARE_COPY.copyThisLink} ${url}` });
    }
  };

  const sharePicture = async () => {
    setStatus({ kind: 'busy' });
    let file = picture.current;
    if (!file) {
      try {
        const blob = await tokenApi.shareImage(tagId);
        file = new File([blob], `seal-${code}.png`, { type: 'image/png' });
        picture.current = file;
      } catch (err) {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : SHARE_COPY.pictureFailed });
        return;
      }
    }

    const canShareFile = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    if (canShareFile) {
      try {
        await navigator.share({ files: [file] });
        setStatus({ kind: 'idle' });
      } catch (err) {
        if (isAbort(err)) setStatus({ kind: 'idle' });
        else if (isNotAllowed(err)) setStatus({ kind: 'again', message: SHARE_COPY.pictureReady });
        else setStatus({ kind: 'error', message: SHARE_COPY.pictureFailed });
      }
      return;
    }
    download(file);
    setStatus({ kind: 'done', message: SHARE_COPY.pictureSaved });
  };

  const busy = status.kind === 'busy';
  const size = compact ? 'sm' : 'md';

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {!compact && <p className="text-gray-400 text-sm">{SHARE_COPY.explainer}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size={size} onClick={shareLink} disabled={busy}>
          {SHARE_COPY.shareLink}
          {compact && <span className="sr-only"> {`for seal ${code}`}</span>}
        </Button>
        <Button variant="secondary" size={size} onClick={sharePicture} disabled={busy} aria-busy={busy}>
          {busy ? SHARE_COPY.preparing : SHARE_COPY.sharePicture}
          {compact && <span className="sr-only"> {`for seal ${code}`}</span>}
        </Button>
      </div>
      <p role="status" aria-live="polite" className={status.kind === 'error' ? 'text-red-300 text-sm break-all' : 'text-gray-300 text-sm'}>
        {status.kind === 'done' || status.kind === 'error' || status.kind === 'again' ? status.message : ''}
      </p>
    </div>
  );
};
