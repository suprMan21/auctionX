import type { RefObject } from 'react';
import { SealBadge } from '@/components/seal/SealBadge';
import { isSealCode } from '@/components/seal/sealCode';
import type { SealSpecView } from '@/components/seal/sealSpec';
import { TAP_COPY, statusCopy } from '../lib/copy';
import { secondsSince, showsSeal, type SealState } from '../lib/sealWindow';
import { TokenStatusBadge } from './TokenStatusBadge';

interface TapSealCardProps {
  readonly lifecycleStatus: string | null;
  /** XXXX-XXXX, or null when the backend has none yet (no seal is drawn then). */
  readonly sealCode: string | null | undefined;
  readonly checkedAt: string | null | undefined;
  /** S-SEAL1 Ph2a: the seal's pattern. Moves only while Verified. */
  readonly sealSpec?: SealSpecView | null;
  readonly state: SealState;
  /** When the server's answer arrived on this phone (ms), for "checked N s ago". */
  readonly freshAt: number | null;
  readonly now: number;
  readonly youOwnThis: boolean;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });

/**
 * The result of a valid tap (DR-22 states, S-SEAL1 Ph1).
 *
 * Verified: the animated seal with its code and live cues, for about 90 s after the tap.
 * Sealed: the still, muted seal; never says Verified. On hold, released and retired seals
 * show the status text only. Never shows a chip serial, UID, chip name or tag id.
 */
export const TapSealCard = ({
  lifecycleStatus,
  sealCode,
  sealSpec,
  checkedAt,
  state,
  freshAt,
  now,
  youOwnThis,
  headingRef,
}: TapSealCardProps) => {
  const status = statusCopy(lifecycleStatus);
  const live = showsSeal(lifecycleStatus);
  const code = isSealCode(sealCode) ? sealCode : null;
  const verified = live && state === 'verified';

  const heading = !live
    ? `${status.label}.`
    : youOwnThis
      ? TAP_COPY.youOwnThis
      : verified
        ? `${TAP_COPY.verifiedJustNow}.`
        : lifecycleStatus === 'ENROLLED'
          ? `${status.label}.`
          : `${TAP_COPY.owned}.`;

  return (
    <section className="am-tap-card">
      <div className="am-tap-verdict">
        {live && code && (
          <SealBadge
            code={code}
            state={verified ? 'verified' : 'sealed'}
            spec={sealSpec}
            label={verified ? `${TAP_COPY.genuine}, ${TAP_COPY.sealCodeLabel.toLowerCase()} ${code}` : `${TAP_COPY.sealed}, ${TAP_COPY.sealCodeLabel.toLowerCase()} ${code}`}
          />
        )}
        <div>
          {live ? (
            <p className={verified ? 'am-tap-kicker' : 'am-tap-kicker am-tap-kicker--sealed'}>
              {verified ? TAP_COPY.genuine : TAP_COPY.sealed}
            </p>
          ) : (
            <TokenStatusBadge status={lifecycleStatus} />
          )}
          <h1 ref={headingRef} tabIndex={-1}>
            {heading}
          </h1>
          {live && code && (
            <p className="am-tap-code">
              {TAP_COPY.sealCodeLabel} <span className="sealcode-mono">{code}</span>
            </p>
          )}
          {live && verified && freshAt !== null && (
            // Not a live region: it changes every second. The status line below announces once.
            <p className="am-tap-cue am-tap-cue--live" aria-live="off">
              <time dateTime={checkedAt ?? undefined}>{TAP_COPY.checkedAgo(secondsSince(freshAt, now))}</time>
              {' · '}
              <span>{clockFormat.format(now)}</span>
            </p>
          )}
          {live && !verified && (
            <p className="am-tap-cue">{freshAt !== null ? TAP_COPY.tapAgainToCheck : TAP_COPY.tapToCheck}</p>
          )}
        </div>
      </div>
      <p className="am-tap-body">{status.detail}</p>
      {live && (
        <p className="sr-only" role="status">
          {verified ? TAP_COPY.verifiedJustNow : freshAt !== null ? TAP_COPY.tapAgainToCheck : ''}
        </p>
      )}
    </section>
  );
};
