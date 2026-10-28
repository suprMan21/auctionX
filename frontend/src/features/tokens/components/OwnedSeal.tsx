import { SealBadge } from '@/components/seal/SealBadge';
import { isSealCode } from '@/components/seal/sealCode';
import { TAP_COPY } from '../lib/copy';
import { showsSeal } from '../lib/sealWindow';

interface OwnedSealProps {
  readonly sealCode: string | null | undefined;
  readonly lifecycleStatus: string | null;
  /** Also print "Seal XXXX-XXXX" next to it (skip when the name already is the code). */
  readonly showCode?: boolean;
}

/**
 * The still Sealed seal for My Tokens and the token page (DR-22 "Owned / Sealed"):
 * no spin, no glow, never "Verified". Nothing for on hold, released or retired seals.
 */
export const OwnedSeal = ({ sealCode, lifecycleStatus, showCode = true }: OwnedSealProps) => {
  if (!isSealCode(sealCode) || !showsSeal(lifecycleStatus)) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <SealBadge code={sealCode} size="sm" state="sealed" />
      {showCode && (
        <span className="text-sm text-gray-300">
          {TAP_COPY.sealCodeLabel} <span className="sealcode-mono">{sealCode}</span>
        </span>
      )}
    </span>
  );
};
