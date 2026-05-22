import type { Database } from '@/types/database.types';

export type BrandType = Database['public']['Enums']['brand_type'];

export const BRAND_LABEL: Record<BrandType, string> = {
  AUCTIONX: 'Authentic Materials',
  UNMENTIONABLES: 'Unmentionables',
};

export const brandLabel = (brand: BrandType | null | undefined): string =>
  brand ? BRAND_LABEL[brand] : '—';
