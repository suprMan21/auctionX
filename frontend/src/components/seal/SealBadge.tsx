import { useId } from 'react';
import './seal.css';
import { SEAL_CODE } from './sealCode';



const SCALLOP =
  'M60.00 6.00Q66.08 2.12 71.23 7.18Q77.98 4.65 81.96 10.67Q89.10 9.60 91.74 16.31Q98.94 16.75 100.13 23.87Q107.08 25.79 106.77 33.00Q113.17 36.33 111.36 43.31Q116.93 47.90 113.70 54.36Q118.20 60.00 113.70 65.64Q116.93 72.10 111.36 76.69Q113.17 83.67 106.77 87.00Q107.08 94.21 100.13 96.13Q98.94 103.25 91.74 103.69Q89.10 110.40 81.96 109.33Q77.98 115.35 71.23 112.82Q66.08 117.88 60.00 114.00Q53.92 117.88 48.77 112.82Q42.02 115.35 38.04 109.33Q30.90 110.40 28.26 103.69Q21.06 103.25 19.87 96.13Q12.92 94.21 13.23 87.00Q6.83 83.67 8.64 76.69Q3.07 72.10 6.30 65.64Q1.80 60.00 6.30 54.36Q3.07 47.90 8.64 43.31Q6.83 36.33 13.23 33.00Q12.92 25.79 19.87 23.87Q21.06 16.75 28.26 16.31Q30.90 9.60 38.04 10.67Q42.02 4.65 48.77 7.18Q53.92 2.12 60.00 6.00Z';

const AM_MARK =
  'M51.63 64.00L42.84 64.00L42.72 55.53L29.76 55.53L24.22 64.00L16.12 64.00L43.55 24.00L55.64 24.00L63.80 50.10L63.90 50.10L72.11 24.00L83.88 24.00L83.88 64.00L76.07 64.00L76.07 33.32L75.97 33.32L66.66 64.00L60.70 64.00L51.73 33.32L51.63 33.32L51.63 64.00ZM42.59 35.64L34.49 48.07L42.65 48.07L42.59 35.64Z';

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
};

/**
 * The genuine AM seal: scalloped badge, AM mark, seal code, and a text ring that turns
 * once every 12 s with a soft 3 s glow pulse. Both animations stop under prefers-reduced-motion
 * and in the still `sealed` state.
 */
export const SealBadge = ({ code, size = 'md', state = 'verified', label }: SealBadgeProps) => {
  if (!SEAL_CODE.test(code)) throw new Error('SealBadge: code must be a seal code (XXXX-XXXX, Crockford base32)');
  // useId returns characters that break url(#…) references; keep it to safe ones.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const grad = `seal-grad-${uid}`;
  const ring = `seal-ring-${uid}`;
  const className = `sealbadge${size === 'md' ? '' : ` sealbadge--${size}`}${state === 'sealed' ? ' sealbadge--sealed' : ''}`;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };

  return (
    <svg className={className} viewBox="0 0 120 120" data-seal-badge="" data-seal-state={state} {...a11y}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset=".55" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <path id={ring} d="M60 60m-40 0a40 40 0 1 1 80 0a40 40 0 1 1 -80 0" />
      </defs>
      <path d={SCALLOP} fill={`url(#${grad})`} />
      <circle cx="60" cy="60" r="31" fill="none" stroke="#ffffff" strokeOpacity=".45" strokeWidth="1" />
      <g className="sealspin">
        <text fill="#ffffff" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="8" fontWeight="800" letterSpacing="1.6">
          <textPath href={`#${ring}`} textLength="248" lengthAdjust="spacing">
            GENUINE · SEALED · AUTHENTIC MATERIALS ·
          </textPath>
        </text>
      </g>
      <path fillRule="evenodd" fill="#ffffff" transform="translate(60 55) scale(.44) translate(-50 -44)" d={AM_MARK} />
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
