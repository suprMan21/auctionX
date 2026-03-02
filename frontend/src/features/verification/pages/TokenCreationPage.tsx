/**
 * TokenCreationPage — Mobile PWA wizard for recording possession-proof video
 * and programming an NTAG 424 DNA NFC tag.
 *
 * Route: /verify/create/:verificationId (protected)
 * Steps: Intro → Record Video → Upload → NFC Tag → Success
 *
 * Web NFC API: Uses (window as any).NDEFReader — no npm package to avoid build bloat.
 * Supported on Chrome for Android only; graceful fallback for iOS/desktop.
 *
 * @module Module 13 — NFC Verification
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { supabase } from '@/features/auth/lib/supabase';
import type { Verification } from '../types/verification';

type Step = 'intro' | 'record' | 'upload' | 'nfc' | 'success';

const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
const supportsWebNFC = 'NDEFReader' in window && !isIOSDevice;

function StepDots({ current }: { current: Step }) {
  const steps: Step[] = ['intro', 'record', 'upload', 'nfc', 'success'];
  return (
    <div className="flex justify-center gap-2 mb-8">
      {steps.map((s) => (
        <div
          key={s}
          className={`w-2 h-2 rounded-full transition-colors ${
            s === current ? 'bg-purple-500' : 'bg-white/20'
          }`}
        />
      ))}
    </div>
  );
}

export function TokenCreationPage() {
  const { verificationId } = useParams<{ verificationId: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('intro');
  const [verification, setVerification] = useState<Verification | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Recording state
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Upload state
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadRetries, setUploadRetries] = useState(0);

  // NFC state
  const [nfcStatus, setNfcStatus] = useState<'idle' | 'scanning' | 'writing' | 'done' | 'error'>('idle');
  const [nfcError, setNfcError] = useState<string | null>(null);

  // Load verification on mount
  useEffect(() => {
    if (!verificationId) return;
    // We already have the ID from the URL — just fetch the record to get token_name
    // Using the public verify endpoint would require the item to be VERIFIED already.
    // Instead, we rely on the listing's ownership (already validated by backend on creation).
    // For now, use createVerification flow — verification was already created; we just need the token name.
    // We'll call the verifications detail via a workaround: store token in location state,
    // or re-fetch from backend. For MVP, we use a direct Supabase query from the client.
    // The RLS "seller_all_own_verifications" policy allows the authenticated seller to read their own row.
    supabase
      .from('item_verifications')
      .select('*')
      .eq('id', verificationId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setLoadError('Could not load verification. Please go back and try again.');
        } else {
          setVerification(data as unknown as Verification);
        }
      });
  }, [verificationId]);

  // Start camera when entering record step
  useEffect(() => {
    if (step !== 'record') return;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: true })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        setCameraError(`Camera unavailable: ${err.message}`);
      });

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [step]);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    const mr = new MediaRecorder(streamRef.current, { mimeType });
    mediaRecorderRef.current = mr;

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mr.onstop = () => {
      const duration = (Date.now() - recordingStartRef.current) / 1000;
      setRecordedDuration(Math.round(duration));
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setRecordedBlob(blob);
      if (previewRef.current) {
        previewRef.current.src = URL.createObjectURL(blob);
      }
    };

    recordingStartRef.current = Date.now();
    setElapsed(0);
    mr.start(500);
    setRecording(true);

    elapsedIntervalRef.current = setInterval(() => {
      const e = (Date.now() - recordingStartRef.current) / 1000;
      setElapsed(Math.floor(e));
      // Auto-stop at 30s
      if (e >= 30) stopRecording();
    }, 500);
  }, []);

  const stopRecording = useCallback(() => {
    if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    mediaRecorderRef.current?.stop();
    setRecording(false);
    stopStream();
  }, []);

  async function handleUpload() {
    if (!recordedBlob || !verificationId) return;
    setStep('upload');
    setUploadProgress(0);
    setUploadError(null);

    const mimeType = recordedBlob.type;

    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      try {
        setUploadRetries(attempt);
        setUploadProgress(10 + attempt * 5);

        const { uploadUrl, publicUrl } = await api.getUploadUrl(verificationId, mimeType);

        setUploadProgress(30);

        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: recordedBlob,
          headers: { 'Content-Type': mimeType },
        });

        if (!uploadResponse.ok) throw new Error(`S3 upload failed: ${uploadResponse.status}`);

        setUploadProgress(75);

        await api.confirmVideoUpload(verificationId, publicUrl, recordedDuration);

        setUploadProgress(100);
        setStep('nfc');
        return;
      } catch (err) {
        attempt++;
        if (attempt >= maxAttempts) {
          setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
        }
      }
    }
  }

  async function handleWebNFC() {
    if (!verificationId || !verification) return;
    setNfcStatus('scanning');
    setNfcError(null);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reader = new (window as any).NDEFReader();
      await reader.scan();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reader.onreading = async (event: any) => {
        const uid = event.serialNumber;
        setNfcStatus('writing');

        const verifyUrl = `${window.location.origin}/verify/${verification.token_name}`;

        try {
          await reader.write({
            records: [{ recordType: 'url', data: verifyUrl }],
          });
        } catch {
          // Writing may fail on some tags but UID is still captured
        }

        await api.registerNfc(verificationId, uid);
        setNfcStatus('done');
        setStep('success');
      };

      reader.onreadingerror = () => {
        setNfcStatus('error');
        setNfcError('Could not read NFC tag. Hold your phone steady against the tag.');
      };
    } catch (err) {
      setNfcStatus('error');
      setNfcError(err instanceof Error ? err.message : 'NFC scan failed');
    }
  }

  async function handleSkipNfc() {
    // Allow proceeding to success without NFC (tag can be programmed later)
    setStep('success');
  }

  function copyLink() {
    if (!verification) return;
    navigator.clipboard.writeText(`${window.location.origin}/verify/${verification.token_name}`).catch(() => {});
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-8 max-w-sm w-full text-center">
          <p className="text-red-400 mb-4">{loadError}</p>
          <button onClick={() => navigate(-1)} className="text-purple-400 underline">Go back</button>
        </div>
      </div>
    );
  }

  if (!verification) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-800 py-8 px-4">
      <div className="max-w-sm mx-auto">
        <StepDots current={step} />

        {/* ── Step 1: Intro ─────────────────────────────────────────────── */}
        {step === 'intro' && (
          <div className="glass rounded-2xl p-8 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white mb-2">Create NFC Token</h1>
              <code className="text-purple-300 text-lg font-mono">{verification.token_name}</code>
            </div>
            <ul className="text-left space-y-3 text-gray-300 text-sm">
              <li className="flex gap-3">
                <span className="text-purple-400 font-bold">1.</span>
                Record a 15–30 second possession-proof video with your item
              </li>
              <li className="flex gap-3">
                <span className="text-purple-400 font-bold">2.</span>
                Upload it to our secure servers
              </li>
              <li className="flex gap-3">
                <span className="text-purple-400 font-bold">3.</span>
                Program your NFC tag — buyers scan it to verify authenticity
              </li>
            </ul>
            <button
              onClick={() => setStep('record')}
              className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors"
            >
              Start Recording
            </button>
          </div>
        )}

        {/* ── Step 2: Record Video ──────────────────────────────────────── */}
        {step === 'record' && (
          <div className="glass rounded-2xl overflow-hidden space-y-0">
            <div className="relative">
              {cameraError ? (
                <div className="h-64 bg-dark-700 flex items-center justify-center px-4">
                  <p className="text-red-400 text-center text-sm">{cameraError}</p>
                </div>
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-64 object-cover bg-black"
                />
              )}
              {recording && (
                <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-white text-sm font-mono">{elapsed}s / 30s</span>
                </div>
              )}
            </div>

            <div className="p-6 space-y-4">
              {recordedBlob && !recording ? (
                <>
                  <p className="text-green-400 text-sm text-center">
                    Recorded {recordedDuration}s
                    {recordedDuration < 15 && ' — needs at least 15 seconds'}
                  </p>
                  <video ref={previewRef} controls className="w-full rounded-xl" />
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setRecordedBlob(null); setRecordedDuration(0); }}
                      className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
                    >
                      Re-record
                    </button>
                    <button
                      onClick={handleUpload}
                      disabled={recordedDuration < 15}
                      className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Use This Video
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-gray-400 text-sm text-center">
                    Hold your item clearly in frame. Min 15s, max 30s.
                  </p>
                  {!recording ? (
                    <button
                      onClick={startRecording}
                      disabled={!!cameraError}
                      className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors disabled:opacity-50"
                    >
                      Start Recording
                    </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      disabled={elapsed < 15}
                      className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors disabled:opacity-50"
                    >
                      {elapsed < 15 ? `Hold for ${15 - elapsed}s more…` : 'Stop Recording'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Upload ────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div className="glass rounded-2xl p-8 text-center space-y-6">
            <h2 className="text-xl font-bold text-white">Uploading Video</h2>
            {uploadRetries > 0 && (
              <p className="text-yellow-400 text-sm">Retry {uploadRetries}/3…</p>
            )}
            <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-gray-400 text-sm">{uploadProgress}%</p>
            {uploadError && (
              <div className="space-y-3">
                <p className="text-red-400 text-sm">{uploadError}</p>
                <button
                  onClick={() => { setStep('record'); setRecordedBlob(null); }}
                  className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
                >
                  Back to Recording
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: NFC Tag ───────────────────────────────────────────── */}
        {step === 'nfc' && (
          <div className="glass rounded-2xl p-8 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white">Program NFC Tag</h2>

            {supportsWebNFC ? (
              <>
                <p className="text-gray-400 text-sm">
                  Hold your NTAG 424 DNA tag to the back of your phone.
                </p>
                {nfcStatus === 'idle' && (
                  <button
                    onClick={handleWebNFC}
                    className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
                  >
                    Scan & Program Tag
                  </button>
                )}
                {nfcStatus === 'scanning' && (
                  <p className="text-blue-400 animate-pulse">Scanning for NFC tag…</p>
                )}
                {nfcStatus === 'writing' && (
                  <p className="text-blue-400 animate-pulse">Writing URL to tag…</p>
                )}
                {nfcStatus === 'error' && nfcError && (
                  <div className="space-y-3">
                    <p className="text-red-400 text-sm">{nfcError}</p>
                    <button
                      onClick={() => { setNfcStatus('idle'); setNfcError(null); }}
                      className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-gray-300 text-sm">
                  {isIOSDevice
                    ? 'iOS does not support Web NFC. Use the NFC Tools app to write this URL to your tag:'
                    : 'Your browser does not support Web NFC. Use the NFC Tools app to write this URL:'}
                </p>
                <code className="block text-purple-300 text-xs bg-dark-700 rounded-xl p-3 break-all">
                  {window.location.origin}/verify/{verification.token_name}
                </code>
                <p className="text-gray-500 text-xs">
                  After programming the tag, come back and tap Skip below.
                </p>
              </>
            )}

            <button
              onClick={handleSkipNfc}
              className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 text-sm font-medium transition-colors"
            >
              Skip for now
            </button>
          </div>
        )}

        {/* ── Step 5: Success ───────────────────────────────────────────── */}
        {step === 'success' && (
          <div className="glass rounded-2xl p-8 text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Token Created!</h2>
              <code className="text-purple-300 text-lg font-mono">{verification.token_name}</code>
            </div>
            <p className="text-gray-400 text-sm">
              Your item now has a verifiable chain of custody. Buyers can scan the NFC tag or use the link below.
            </p>
            <div className="flex gap-3">
              <button
                onClick={copyLink}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
              >
                Copy Link
              </button>
              <button
                onClick={() => navigate(`/verify/${verification.token_name}`)}
                className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors"
              >
                View Token
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
