import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/common/Button';

/**
 * Live camera capture for re-issue evidence (S-ADMIN1 Ph2).
 *
 * Photos come only from the live camera, never from a file picker, so they show
 * the chip as it is right now (Boss, 2026-10-09: "that way we know its real").
 * Each still is scaled to at most 1600 px on the long side and saved as JPEG,
 * well under the 5 MB the server accepts.
 */

export const MAX_PHOTOS = 3;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export interface CapturedPhoto {
  readonly id: string;
  readonly blob: Blob;
  readonly previewUrl: string;
}

interface ChipPhotoCaptureProps {
  readonly photos: readonly CapturedPhoto[];
  readonly onChange: (photos: CapturedPhoto[]) => void;
  readonly disabled?: boolean;
}

type Camera = { kind: 'off' } | { kind: 'starting' } | { kind: 'live' } | { kind: 'error'; message: string };

let photoSeq = 0;

export const ChipPhotoCapture = ({ photos, onChange, disabled = false }: ChipPhotoCaptureProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<Camera>({ kind: 'off' });

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Release the camera when the component goes away.
  useEffect(() => () => stopStream(), []);

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera({ kind: 'error', message: 'This browser cannot open the camera. Try your phone’s main browser.' });
      return;
    }
    setCamera({ kind: 'starting' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setCamera({ kind: 'live' });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setCamera({ kind: 'error', message: 'We could not open the camera. Allow camera access for this site and try again.' });
    }
  };

  // The <video> mounts on the render after `live`; attach the stream then.
  useEffect(() => {
    if (camera.kind === 'live' && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [camera.kind]);

  const stopCamera = () => {
    stopStream();
    setCamera({ kind: 'off' });
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || photos.length >= MAX_PHOTOS) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        photoSeq += 1;
        const next = [...photos, { id: `photo-${photoSeq}`, blob, previewUrl: URL.createObjectURL(blob) }];
        onChange(next);
        if (next.length >= MAX_PHOTOS) stopCamera();
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  };

  const remove = (id: string) => {
    const gone = photos.find((p) => p.id === id);
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    onChange(photos.filter((p) => p.id !== id));
  };

  const full = photos.length >= MAX_PHOTOS;

  return (
    <div className="space-y-4">
      {camera.kind === 'live' && (
        <div className="space-y-3">
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Camera preview"
            className="w-full rounded-2xl bg-black aspect-[4/3] object-cover"
          />
          <div className="flex flex-wrap gap-3">
            <Button onClick={capture} disabled={disabled || full}>
              Take photo ({photos.length} of {MAX_PHOTOS})
            </Button>
            <Button variant="ghost" onClick={stopCamera}>
              Close camera
            </Button>
          </div>
        </div>
      )}

      {camera.kind !== 'live' && !full && (
        <Button
          variant="secondary"
          onClick={startCamera}
          disabled={disabled || camera.kind === 'starting'}
          aria-busy={camera.kind === 'starting'}
        >
          {camera.kind === 'starting' ? 'Opening camera…' : photos.length ? 'Take another photo' : 'Open camera'}
        </Button>
      )}

      {camera.kind === 'error' && (
        <p role="alert" className="text-red-300 text-sm">
          {camera.message}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-3" aria-label="Photos taken">
          {photos.map((p, i) => (
            <li key={p.id} className="relative">
              <img
                src={p.previewUrl}
                alt={`Photo ${i + 1} of the chip on the item`}
                className="h-28 w-28 rounded-xl object-cover border border-white/10"
              />
              <button
                type="button"
                onClick={() => remove(p.id)}
                disabled={disabled}
                className="mt-1 w-full text-xs text-gray-300 underline hover:text-white rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                Remove photo {i + 1}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
