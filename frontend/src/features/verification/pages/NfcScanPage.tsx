import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ScanResult, NfcTagDetail } from '../types/nfc';

export function NfcScanPage() {
  const [searchParams] = useSearchParams();
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [tagDetail, setTagDetail] = useState<NfcTagDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function performScan() {
      try {
        const sunMessage = searchParams.get('sun');
        const piccData = searchParams.get('e');
        const cmac = searchParams.get('m');
        const tagUid = searchParams.get('uid');

        let scanResult: ScanResult;

        if (sunMessage) {
          scanResult = await api.nfcScan({ sunMessage });
        } else if (piccData && cmac && tagUid) {
          scanResult = await api.nfcScan({ piccData, cmac, tagUid });
        } else {
          if (mounted) setError('Missing scan parameters. Expected ?sun= or ?e=&m=&uid=');
          return;
        }

        if (!mounted) return;
        setResult(scanResult);

        // Fetch tag detail on success
        if (scanResult.tagId) {
          try {
            const detail = await api.nfcGetTag(scanResult.tagId);
            if (mounted) setTagDetail(detail);
          } catch {
            // Non-fatal — detail fetch failure shouldn't block scan result
          }
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Scan failed');
      } finally {
        if (mounted) setScanning(false);
      }
    }

    performScan();

    return () => { mounted = false; };
  }, [searchParams]);

  // Loading state
  if (scanning) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-12 max-w-sm w-full text-center">
          <div className="relative mx-auto w-20 h-20 mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-20 h-20 text-primary-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <p className="text-white text-lg font-semibold" aria-live="polite">Verifying authenticity...</p>
          <p className="text-gray-400 text-sm mt-2">Validating NFC scan data</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !result) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-12 max-w-sm w-full text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-900/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2" aria-live="polite">Verification Failed</h1>
          <p className="text-gray-400 mb-6">{error ?? 'Unable to verify this scan.'}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Valid scan
  if (result.valid) {
    const tokenName = tagDetail?.verification?.token_name;
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-12 max-w-md w-full text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-900/30 flex items-center justify-center">
            <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2" aria-live="polite">Authentic Item</h1>
          <p className="text-gray-400 mb-1">This item has been verified as authentic.</p>

          {tagDetail && (
            <div className="mt-6 space-y-2 text-sm text-left">
              <div className="flex justify-between">
                <span className="text-gray-400">Tag UID</span>
                <span className="text-white font-mono">{tagDetail.tag.tag_uid}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Scans</span>
                <span className="text-white">{tagDetail.tag.sun_counter}</span>
              </div>
              {tagDetail.seller && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Seller</span>
                  <span className="text-white">@{tagDetail.seller.username}</span>
                </div>
              )}
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3">
            {tokenName && (
              <Link
                to={`/verify/${tokenName}`}
                className="py-3 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 hover:opacity-90 text-white font-semibold transition-colors text-center"
              >
                View Verification Page
              </Link>
            )}
            <Link
              to={`/nfc/${result.tagId}`}
              className="py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition-colors text-center"
            >
              View Tag Details
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Invalid scan
  return (
    <div className="min-h-screen bg-dark-800 flex items-center justify-center px-4">
      <div className="glass rounded-2xl p-12 max-w-sm w-full text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2" aria-live="polite">Verification Failed</h1>
        <p className="text-gray-400 mb-6">The NFC scan could not be verified. This tag may be counterfeit or tampered with.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
