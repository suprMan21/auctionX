/**
 * Shared by the token reset (S-ADMIN1) and re-issue fulfilment (Ph2): the
 * replacement-chip list and the typed confirmation of the chip being retired.
 */

import { useEffect, useState } from 'react';
import { adminApi, confirmationSuffixOf, type AdminTag } from '../api/adminApi';

/** True when the typed text is the chip's confirmation suffix (serial on v2, UID on v1). */
export const confirmsChip = (chip: Pick<AdminTag, 'uidSuffix' | 'serialSuffix'>, typed: string): boolean =>
  typed.trim().toUpperCase() === confirmationSuffixOf(chip);

/**
 * ENROLLED, unclaimed chips (excluding `excludeId`), loaded each time `open`
 * turns true. Results are keyed by the load that produced them, so "loading"
 * is derived rather than reset inside the effect.
 */
export const useEnrolledChips = (open: boolean, excludeId: string) => {
  const [loadCount, setLoadCount] = useState(0);
  const [result, setResult] = useState<{ load: number; tags: AdminTag[] } | null>(null);
  const [failure, setFailure] = useState<{ load: number; message: string } | null>(null);

  // A new load each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setLoadCount((n) => n + 1);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = loadCount;
    adminApi
      .listTags({ status: 'ENROLLED', limit: 100 })
      .then((res) => { if (!cancelled) setResult({ load, tags: res.data.tags.filter((t) => t.id !== excludeId) }); })
      .catch((err) => {
        if (!cancelled) setFailure({ load, message: err instanceof Error ? err.message : 'Could not load enrolled chips' });
      });
    return () => { cancelled = true; };
  }, [open, excludeId, loadCount]);

  return {
    candidates: result?.load === loadCount ? result.tags : null,
    loadError: failure?.load === loadCount ? failure.message : null,
  };
};
