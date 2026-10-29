import { useId } from 'react';
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

/** One electron: a bright dot, a 4-dot fading tail and a faint halo, tracing a ring's loops. */
type ElectronProps = { pathId: string; dur: number; offset: number; radius: number; reverse?: boolean };

const TAIL = [
  { scale: 1, opacity: 1 },
  { scale: 0.8, opacity: 0.55 },
  { scale: 0.6, opacity: 0.3 },
  { scale: 0.4, opacity: 0.15 },
] as const;
const TAIL_STEP_S = 0.12;

const Electron = ({ pathId, dur, offset, radius, reverse = false }: ElectronProps) => {
  const motion = (begin: number) => (
    <animateMotion
      dur={`${dur}s`}
      begin={`${-(offset + begin)}s`}
      repeatCount="indefinite"
      {...(reverse ? { keyPoints: '1;0', keyTimes: '0;1', calcMode: 'linear' } : {})}
    >
      <mpath href={`#${pathId}`} />
    </animateMotion>
  );
  return (
    <>
      {TAIL.map((t, i) => (
        <circle key={i} r={radius * t.scale} fill="#ffffff" opacity={t.opacity}>
          {motion(i * TAIL_STEP_S)}
        </circle>
      ))}
      <circle r={radius * 1.6} fill="#ffffff" opacity=".18">
        {motion(0)}
      </circle>
    </>
  );
};

/**
 * The genuine AM seal: scalloped badge, AM mark, seal code, and a text ring that turns
 * once every 12 s with a soft 3 s glow pulse. With a spec, its two pattern rings sit inside
 * the badge; in the Verified state they turn and electrons trace their loops.
 * All motion stops under prefers-reduced-motion and in the still `sealed` state.
 */
export const SealBadge = ({ code, size = 'md', state = 'verified', label, spec }: SealBadgeProps) => {
  const reducedMotion = useReducedMotion();
  if (!SEAL_CODE.test(code)) throw new Error('SealBadge: code must be a seal code (XXXX-XXXX, Crockford base32)');
  // useId returns characters that break url(#…) references; keep it to safe ones.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const grad = `seal-grad-${uid}`;
  const ring = `seal-ring-${uid}`;
  const clip = `seal-clip-${uid}`;
  const outerId = `seal-po-${uid}`;
  const innerId = `seal-pi-${uid}`;
  const className = `sealbadge${size === 'md' ? '' : ` sealbadge--${size}`}${state === 'sealed' ? ' sealbadge--sealed' : ''}`;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };

  const [outer, inner] = spec?.v === 1 ? spec.pattern.paths : [];
  const drawPattern = typeof outer === 'string' && SEAL_PATH.test(outer) && typeof inner === 'string' && SEAL_PATH.test(inner);
  // Electrons exist only while Verified: leaving them out of the DOM is what stops them.
  const electrons = drawPattern && state === 'verified' && !reducedMotion;
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
      </defs>
      <path d={G.scallop} fill={`url(#${grad})`} />
      {drawPattern && (
        <g clipPath={`url(#${clip})`} fill="none" stroke="#ffffff" strokeWidth=".35" strokeLinejoin="round" data-seal-rings="">
          <g className="sealrot-out">
            <path id={outerId} d={outer} strokeOpacity=".2" />
            {electrons && (
              <>
                <Electron pathId={outerId} dur={30} offset={0} radius={0.9} />
                <Electron pathId={outerId} dur={30} offset={15} radius={0.9} />
              </>
            )}
          </g>
          <g className="sealrot-in">
            <path id={innerId} d={inner} strokeOpacity=".14" />
            {electrons && <Electron pathId={innerId} dur={20} offset={0} radius={0.75} reverse />}
          </g>
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
