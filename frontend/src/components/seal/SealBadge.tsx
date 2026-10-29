import { useEffect, useId, useRef } from 'react';
import './seal.css';
import { SEAL_GEOMETRY as G } from './geometry';
import { SEAL_CODE } from './sealCode';
import { SEAL_PATH, sealColors, type SealSpecView } from './sealSpec';
import { useReducedMotion } from './useReducedMotion';

type SealBadgeProps = {
  /** Seal code to print in the centre. Never a chip serial or UID. */
  code: string;
  size?: 'hero' | 'md' | 'sm';
  /**
   * DR-22 states. `verified` (default): animated, only right after a tap the server accepted.
   * `sealed`: still and muted, for a remembered tap, My Seals and the seal page. Never says Verified.
   */
  state?: 'verified' | 'sealed';
  /** Accessible name. Omit for decorative instances (rendered aria-hidden). */
  label?: string;
  /**
   * S-SEAL1 Ph2a: this seal's stored spec (pattern v1). Without one (older backend, homepage demo)
   * the badge draws exactly what it drew before.
   */
  spec?: SealSpecView | null;
};

/** Holographic colours (Shimmer, Boss 2026-10-28): cyan, violet, pink, gold, mint. */
const HOLO_STOPS = [
  ['0', '#7df9ff'],
  ['.2', '#b388ff'],
  ['.4', '#ff80bf'],
  ['.6', '#ffe57f'],
  ['.8', '#80ffb0'],
  ['1', '#7df9ff'],
] as const;

/** Sweep: crosses in 3 s, first 1 s after the seal appears, then every 30 s. */
// The band (centre at x 0, 38 wide, tilted 25° about the centre) starts fully off one side
// and ends fully off the other, so it crosses the whole badge.
const SWEEP = { dur: '30s', keyTimes: '0;.033;.133;1', values: '-50 0;-50 0;170 0;170 0', start: 'translate(-50 0)' } as const;

const HoloGradient = ({ id, turnSeconds, startAngle, animate }: { id: string; turnSeconds: number; startAngle: number; animate: boolean }) => (
  <linearGradient
    id={id}
    gradientUnits="userSpaceOnUse"
    x1="20"
    y1="20"
    x2="100"
    y2="100"
    spreadMethod="reflect"
    gradientTransform={`rotate(${startAngle} 60 60)`}
  >
    {HOLO_STOPS.map(([offset, color]) => (
      <stop key={offset} offset={offset} stopColor={color} />
    ))}
    {animate && (
      <animateTransform
        attributeName="gradientTransform"
        type="rotate"
        from={`${startAngle} 60 60`}
        to={`${startAngle + 360} 60 60`}
        dur={`${turnSeconds}s`}
        repeatCount="indefinite"
      />
    )}
  </linearGradient>
);

/**
 * The genuine AM seal: scalloped badge, AM mark, seal code, and a text ring that turns
 * once every 12 s with a soft 3 s glow pulse. With a spec, its two pattern rings sit inside
 * the badge. Verified (Shimmer, Boss 2026-10-28): the rings turn, their lines are holographic,
 * a faint rainbow sheen sits on the badge and a rainbow glint sweeps across every 30 s.
 * Sealed: white, still rings, no sheen. Reduce Motion: nothing moves.
 */
export const SealBadge = ({ code, size = 'md', state = 'verified', label, spec }: SealBadgeProps) => {
  const reducedMotion = useReducedMotion();
  if (!SEAL_CODE.test(code)) throw new Error('SealBadge: code must be a seal code (XXXX-XXXX, Crockford base32)');
  // useId returns characters that break url(#…) references; keep it to safe ones.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const grad = `seal-grad-${uid}`;
  const ring = `seal-ring-${uid}`;
  const clip = `seal-clip-${uid}`;
  const holo = `seal-holo-${uid}`;
  const sheen = `seal-sheen-${uid}`;
  const band = `seal-band-${uid}`;
  const sweep = `seal-sweep-${uid}`;
  const badgeClip = `seal-badge-${uid}`;
  const sweepRef = useRef<SVGAnimateTransformElement | null>(null);
  const className = `sealbadge${size === 'md' ? '' : ` sealbadge--${size}`}${state === 'sealed' ? ' sealbadge--sealed' : ''}`;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };

  const [outer, inner] = spec?.v === 1 ? spec.pattern.paths : [];
  const drawPattern = typeof outer === 'string' && SEAL_PATH.test(outer) && typeof inner === 'string' && SEAL_PATH.test(inner);
  const verifiedLook = drawPattern && state === 'verified';
  // Moving parts exist only while Verified and motion is allowed: leaving them out of the DOM stops them.
  const animate = verifiedLook && !reducedMotion;

  // Start the sweep from the moment this seal appears, not from page load.
  useEffect(() => {
    const el = sweepRef.current;
    if (el && typeof el.beginElement === 'function') el.beginElement();
  }, [animate]);
  const [c0, c1, c2] = sealColors(spec?.colors);

  return (
    <svg className={className} viewBox={`0 0 ${G.viewBox} ${G.viewBox}`} data-seal-badge="" data-seal-state={state} data-seal-pattern={drawPattern ? 'v1' : undefined} {...a11y}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c0} />
          <stop offset=".55" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
        <path id={ring} d={G.ringPath} />
        {drawPattern && (
          <clipPath id={clip}>
            <circle cx="60" cy="60" r={G.patternClipR} />
          </clipPath>
        )}
        {verifiedLook && (
          <>
            <HoloGradient id={holo} turnSeconds={8} startAngle={0} animate={animate} />
            <HoloGradient id={sheen} turnSeconds={14} startAngle={120} animate={animate} />
            <clipPath id={badgeClip}>
              <path d={G.scallop} />
            </clipPath>
          </>
        )}
        {animate && (
          <>
            <linearGradient id={band} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#000000" />
              <stop offset=".42" stopColor="#000000" />
              <stop offset=".5" stopColor="#ffffff" />
              <stop offset=".58" stopColor="#000000" />
              <stop offset="1" stopColor="#000000" />
            </linearGradient>
            <mask id={sweep} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
              <g transform="rotate(25 60 60)">
                <rect x="-120" y="-30" width="240" height="180" fill={`url(#${band})`} transform={SWEEP.start}>
                  <animateTransform
                    ref={sweepRef}
                    attributeName="transform"
                    type="translate"
                    values={SWEEP.values}
                    keyTimes={SWEEP.keyTimes}
                    dur={SWEEP.dur}
                    begin="indefinite"
                    repeatCount="indefinite"
                  />
                </rect>
              </g>
            </mask>
          </>
        )}
      </defs>
      <path d={G.scallop} fill={`url(#${grad})`} />
      {verifiedLook && (
        // Rainbow sheen: faint all the time, bright inside the sweep band.
        <g clipPath={`url(#${badgeClip})`} style={{ mixBlendMode: 'screen' }} data-seal-sheen="">
          <rect width="120" height="120" fill={`url(#${sheen})`} opacity=".16" />
          {animate && <rect width="120" height="120" fill={`url(#${sheen})`} opacity=".55" mask={`url(#${sweep})`} />}
        </g>
      )}
      {drawPattern && (
        <g
          clipPath={`url(#${clip})`}
          fill="none"
          stroke={verifiedLook ? `url(#${holo})` : '#ffffff'}
          strokeWidth=".35"
          strokeLinejoin="round"
          data-seal-rings=""
        >
          <g className="sealrot-out">
            <path d={outer} strokeOpacity={verifiedLook ? '.45' : '.2'} />
          </g>
          <g className="sealrot-in">
            <path d={inner} strokeOpacity={verifiedLook ? '.35' : '.14'} />
          </g>
          {animate && (
            <g mask={`url(#${sweep})`} strokeWidth=".7" data-seal-glint="">
              <g className="sealrot-out">
                <path d={outer} />
              </g>
              <g className="sealrot-in">
                <path d={inner} />
              </g>
            </g>
          )}
        </g>
      )}
      <circle cx="60" cy="60" r={G.innerCircleR} fill="none" stroke="#ffffff" strokeOpacity=".45" strokeWidth="1" />
      <g className="sealspin">
        <text fill="#ffffff" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="8" fontWeight="800" letterSpacing="1.6">
          <textPath href={`#${ring}`} textLength="248" lengthAdjust="spacing">
            GENUINE · SEALED · AUTHENTIC MATERIALS ·
          </textPath>
        </text>
      </g>
      <path fillRule="evenodd" fill="#ffffff" transform={G.amMarkTransform} d={G.amMark} />
      <text
        x="60"
        y="80"
        textAnchor="middle"
        fill="#ffffff"
        fontFamily="'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize="6.6"
        fontWeight="700"
        letterSpacing=".6"
      >
        {code}
      </text>
    </svg>
  );
};
