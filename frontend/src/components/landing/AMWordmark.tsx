import { useId } from 'react';
import { Link } from 'react-router-dom';
import { BRAND_LABEL } from '@/constants/branding';

interface AMWordmarkProps {
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: { am: 'h-6', full: 'text-xs', gap: 'gap-1.5' },
  md: { am: 'h-9', full: 'text-sm', gap: 'gap-2' },
  lg: { am: 'h-12', full: 'text-base', gap: 'gap-2.5' },
};

// The settled merged AM mark, traced from the artwork (`aM_logo_1.1.1.svg`,
// `design-assets/svg/am-mark.svg`). Never set "AM" in a font instead.
const AM_MARK_PATH =
  'M51.63 64.00L42.84 64.00L42.72 55.53L29.76 55.53L24.22 64.00L16.12 64.00L43.55 24.00L55.64 24.00L63.80 50.10L63.90 50.10L72.11 24.00L83.88 24.00L83.88 64.00L76.07 64.00L76.07 33.32L75.97 33.32L66.66 64.00L60.70 64.00L51.73 33.32L51.63 33.32L51.63 64.00ZM42.59 35.64L34.49 48.07L42.65 48.07L42.59 35.64Z';

export const AMWordmark = ({ size = 'md' }: AMWordmarkProps) => {
  const s = sizeMap[size];
  const gradientId = useId();

  return (
    <Link to="/" className={`inline-flex flex-col ${s.gap} no-underline`} aria-label={`${BRAND_LABEL.AUCTIONX} home`}>
      <svg viewBox="16 24 68 40" className={`${s.am} w-auto self-start`} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c3aed" />
            <stop offset="0.5" stopColor="#6366f1" />
            <stop offset="1" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <path fillRule="evenodd" fill={`url(#${gradientId})`} d={AM_MARK_PATH} />
      </svg>
      <span className={`${s.full} font-medium tracking-[0.2em] uppercase text-gray-400`}>
        {BRAND_LABEL.AUCTIONX}
      </span>
    </Link>
  );
};
