import { useEffect, useId, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { MyToken, OwnerReissue } from '../api/schemas';
import { forgetTapSession, isSessionLive, loadTap } from '../lib/tapCache';
import { isOpenReissue, REISSUE_STAGE_COPY, reissueStage } from '../lib/reissue';
import { ChipPhotoCapture, type CapturedPhoto } from '../components/ChipPhotoCapture';
import { tokenDisplayName } from './MyTokensPage';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-owner' }
  | { kind: 'ready'; token: MyToken; open: OwnerReissue | null };

type Submit =
  | { kind: 'idle' }
  | { kind: 'sending'; step: string }
  | { kind: 'error'; message: string }
  | { kind: 'sent' };

const requestErrorCopy = (err: unknown): string => {
  if (!(err instanceof TokenApiError)) return 'Something went wrong. Please try again.';
  if (err.reason === 'tap_session_invalid') return 'Your tap has expired or was already used. Tap the chip again, then come back to this page.';
  if (err.code === 'conflict') return 'A replacement request is already open for this token.';
  return err.message;
};

/**
 * `/tokens/:tagId/replace?tap=<token name>` — ask for a replacement chip.
 *
 * Only for a chip that is coming loose and is still on the item. A chip that has
 * already come off is not replaced (Boss, 2026-10-09). Proof is a live tap of
 * this chip (the tap that opened the verify page, 10 minutes) plus 1–3 photos
 * from the live camera. Nothing is charged here; the fee is asked for only if
 * we approve.
 */
export const ReissueRequestPage = () => {
  const { tagId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const tokenName = searchParams.get('tap') ?? '';
  const attachedId = useId();

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [attached, setAttached] = useState(false);
  const [submit, setSubmit] = useState<Submit>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([tokenApi.myTokens(), tokenApi.myReissueRequests()])
      .then(([tokens, requests]) => {
        if (cancelled) return;
        const token = tokens.find((t) => t.tagId === tagId);
        if (!token) return setLoad({ kind: 'not-owner' });
        setLoad({ kind: 'ready', token, open: requests.find((r) => r.tagId === tagId && isOpenReissue(r)) ?? null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
      });
    return () => { cancelled = true; };
  }, [tagId]);

  // Free the preview images when leaving the page (only then: they are still
  // on screen while the owner adds more).
  const photosRef = useRef(photos);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  const tap = tokenName ? loadTap(tokenName) : null;
  const liveTap = tap && tap.valid && tap.tagId === tagId && isSessionLive(tap) ? tap.tapSession!.token : null;

  const send = async () => {
    if (!liveTap || photos.length === 0 || !attached) return;
    try {
      const keys: string[] = [];
      for (const [i, photo] of photos.entries()) {
        setSubmit({ kind: 'sending', step: `Uploading photo ${i + 1} of ${photos.length}…` });
        keys.push(await tokenApi.uploadReissuePhoto(photo.blob));
      }
      setSubmit({ kind: 'sending', step: 'Sending your request…' });
      await tokenApi.requestReissue({ tagId, tapSession: liveTap, photoKeys: keys });
      forgetTapSession(tokenName);
      setSubmit({ kind: 'sent' });
    } catch (err) {
      // Any answer from the request endpoint may have spent the tap.
      if (err instanceof TokenApiError && err.status !== 0 && err.code !== 'upload_failed') forgetTapSession(tokenName);
      setSubmit({ kind: 'error', message: requestErrorCopy(err) });
    }
  };

  const busy = submit.kind === 'sending';

  return (
    <main id="main-content" className="min-h-screen bg-dark-800 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link to={`/tokens/${tagId}`} className="text-sm text-gray-400 hover:text-white">
          <span aria-hidden="true">← </span>Back to the token
        </Link>

        {load.kind === 'loading' && (
          <div role="status" className="glass rounded-2xl p-8 text-center text-gray-300">Loading…</div>
        )}
        {load.kind === 'error' && (
          <div role="alert" className="glass rounded-2xl p-8 text-center text-red-300">{load.message}</div>
        )}
        {load.kind === 'not-owner' && (
          <div className="glass rounded-2xl p-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-2">Not in your collection.</h1>
            <p className="text-gray-400">Only the registered owner can ask for a replacement chip.</p>
          </div>
        )}

        {load.kind === 'ready' && submit.kind === 'sent' && (
          <section className="glass rounded-2xl p-8" role="status">
            <h1 className="text-2xl font-bold text-white mb-2">{REISSUE_STAGE_COPY.review.title}</h1>
            <p className="text-gray-400 mb-4">{REISSUE_STAGE_COPY.review.body}</p>
            <Link to={`/tokens/${tagId}`} className="text-primary-300 underline hover:text-primary-200">
              Back to the token
            </Link>
          </section>
        )}

        {load.kind === 'ready' && submit.kind !== 'sent' && load.open && (
          <section className="glass rounded-2xl p-8">
            <h1 className="text-2xl font-bold text-white mb-2">{REISSUE_STAGE_COPY[reissueStage(load.open)].title}</h1>
            <p className="text-gray-400 mb-4">{REISSUE_STAGE_COPY[reissueStage(load.open)].body}</p>
            <Link to={`/tokens/${tagId}`} className="text-primary-300 underline hover:text-primary-200">
              Back to the token
            </Link>
          </section>
        )}

        {load.kind === 'ready' && submit.kind !== 'sent' && !load.open && (
          <>
            <section className="glass rounded-2xl p-8">
              <h1 className="text-2xl font-bold text-white mb-2">Replace a chip that is coming loose</h1>
              <p className="text-gray-400 mb-3">
                For {tokenDisplayName(load.token)}. Ask now, while the chip is still on the item. We move your token to
                a new chip and retire the old one.
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-gray-300">
                <li>We can only replace a chip that is still attached. If it has already come off, we cannot replace it.</li>
                <li>Leave the chip where it is until the new one arrives.</li>
                <li>Nothing is charged now. If we approve, you pay a replacement fee on this website.</li>
              </ul>
            </section>

            {/* Outside the form: a rejected tap is forgotten, which swaps the form for
                "Tap the chip first", and the owner still needs to read why. */}
            {submit.kind === 'error' && (
              <p role="alert" className="text-red-300 text-sm">{submit.message}</p>
            )}

            {!liveTap ? (
              <section className="glass rounded-2xl p-6" aria-labelledby="tap-first">
                <h2 id="tap-first" className="text-lg font-semibold text-white mb-2">Tap the chip first</h2>
                <p className="text-gray-400 text-sm">
                  Hold your phone to the chip on the item. On the page that opens, choose “Chip coming loose?”. You
                  then have 10 minutes to take the photos and send the request.
                </p>
              </section>
            ) : (
              <section className="glass rounded-2xl p-6 space-y-5" aria-labelledby="photos-heading">
                <div>
                  <h2 id="photos-heading" className="text-lg font-semibold text-white mb-1">Take photos of the chip</h2>
                  <p className="text-gray-400 text-sm">
                    Take 1 to 3 photos that show the chip on the item and where it is lifting. Use good light.
                  </p>
                </div>

                <ChipPhotoCapture photos={photos} onChange={setPhotos} disabled={busy} />

                <div className="flex items-start gap-3">
                  <input
                    id={attachedId}
                    type="checkbox"
                    checked={attached}
                    onChange={(e) => setAttached(e.target.checked)}
                    disabled={busy}
                    className="mt-1 h-4 w-4 rounded accent-primary-500 focus:ring-2 focus:ring-primary-500"
                  />
                  <label htmlFor={attachedId} className="text-sm text-gray-300">
                    The chip is still attached to the item.
                  </label>
                </div>

                {submit.kind === 'sending' && (
                  <p role="status" className="text-gray-300 text-sm">{submit.step}</p>
                )}

                <Button
                  onClick={send}
                  disabled={busy || photos.length === 0 || !attached}
                  aria-busy={busy}
                >
                  {busy ? 'Sending…' : 'Send replacement request'}
                </Button>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
};
