import { isMarketplaceEnabledOnClient } from '@/lib/featureFlags';

/** S-ADMIN2 AC 11: /my-listings is parked with the marketplace; land on My Tokens. */
export const afterProfileLanding = (): string => (isMarketplaceEnabledOnClient() ? '/my-listings' : '/tokens');
