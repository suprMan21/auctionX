/**
 * A token's chip shown on two lines: the name first, then the serial and
 * hardware ID endings in small grey text. Easier to scan than chipLabel()'s
 * one-line "name · …uid · sn …serial", which stays for dialog titles and other
 * plain-text uses.
 */

import type { AdminTag } from '../api/adminApi';

type ChipIds = Pick<AdminTag, 'chipName' | 'uidSuffix' | 'serialSuffix'>;

/** "Serial …AE6CA9", "Hardware ID …936980", in that order (v1 chips have no serial). */
const idParts = (tag: ChipIds): string[] => [
  ...(tag.serialSuffix ? [`Serial …${tag.serialSuffix}`] : []),
  `Hardware ID …${tag.uidSuffix}`,
];

export const ChipName = ({ tag, className = '' }: { tag: ChipIds; className?: string }) => {
  const ids = idParts(tag);
  // No name: the first ID becomes the main line.
  const main = tag.chipName ?? ids[0];
  const rest = tag.chipName ? ids : ids.slice(1);
  return (
    <span className={className}>
      {/* One clean phrase for screen readers ("chip_004, Serial …0351DE, Hardware ID …936980"); the two lines are visual only. */}
      <span className="sr-only">{[main, ...rest].join(', ')}</span>
      <span aria-hidden="true" className="inline-flex flex-col">
        <span className="font-mono">{main}</span>
        {rest.length > 0 && <span className="text-xs font-normal text-gray-400">{rest.join(' · ')}</span>}
      </span>
    </span>
  );
};
