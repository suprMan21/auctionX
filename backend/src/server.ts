import dotenv from 'dotenv';
import { createApp } from './app';
import { log } from './lib/logger';
import { isMarketplaceEnabled } from './lib/featureFlags';

dotenv.config();

const app = createApp();
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  const marketplace = isMarketplaceEnabled();
  log.info('server_started', { port: PORT, marketplace });

  console.log(`✅ Backend server running on http://localhost:${PORT}`);
  console.log(`🔖 Marketplace: ${marketplace ? 'ENABLED' : 'PARKED (S-ISO1)'}`);
  console.log(`📡 Token endpoints:`);
  console.log(`   GET  /api/v1/health`);
  console.log(`   POST /api/v1/nfc/scan`);
  console.log(`   GET  /api/v1/nfc/:tagId`);
  console.log(`   GET  /api/v1/verify/:tokenName`);
  console.log(`   POST /api/v1/verification/start`);

  if (marketplace) {
    console.log(`🛒 Marketplace endpoints (FEATURE_MARKETPLACE=true):`);
    console.log(`   GET  /api/v1/auctions/:id`);
    console.log(`   POST /api/v1/auctions/:id/bids`);
    console.log(`   GET  /api/v1/search`);
    console.log(`   GET  /api/v1/conversations`);
  }
});
