import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { NfcTag, NfcTagDetail } from '../types/nfc';

export function useNfcTags() {
  const [tags, setTags] = useState<NfcTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = () => {
    let mounted = true;

    setLoading(true);
    setError(null);

    api.nfcGetTags()
      .then((data) => {
        if (mounted) setTags(data);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to fetch tags');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  };

  useEffect(() => {
    const cleanup = refetch();
    return cleanup;
  }, []);

  return { tags, loading, error, refetch };
}

export function useNfcTagDetail(tagId: string | undefined) {
  const [detail, setDetail] = useState<NfcTagDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tagId) return;

    let mounted = true;

    setLoading(true);
    setError(null);

    api.nfcGetTag(tagId)
      .then((data) => {
        if (mounted) setDetail(data);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to fetch tag detail');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [tagId]);

  return { detail, loading, error };
}
