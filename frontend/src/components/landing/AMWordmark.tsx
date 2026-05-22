import { Link } from 'react-router-dom';
import { BRAND_LABEL } from '@/constants/branding';

interface AMWordmarkProps {
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: { am: 'text-2xl', full: 'text-xs', gap: 'gap-1' },
  md: { am: 'text-4xl', full: 'text-sm', gap: 'gap-1.5' },
  lg: { am: 'text-5xl', full: 'text-base', gap: 'gap-2' },
};

export const AMWordmark = ({ size = 'md' }: AMWordmarkProps) => {
  const s = sizeMap[size];

  return (
    <Link to="/" className={`inline-flex flex-col ${s.gap} no-underline`} aria-label={`${BRAND_LABEL.AUCTIONX} home`}>
      <span className={`${s.am} font-extrabold tracking-tight text-gradient`}>
        AM
      </span>
      <span className={`${s.full} font-medium tracking-[0.2em] uppercase text-gray-400`}>
        {BRAND_LABEL.AUCTIONX}
      </span>
    </Link>
  );
};
