import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { log } from './lib/logger';
import healthRoutes from './routes/health';
import auctionRoutes from './routes/auctions';
import webhookRoutes from './routes/webhooks';
import adminRoutes from './routes/admin/index';
import settlementRoutes from './routes/settlements';
import payoutRoutes from './routes/payouts';
import { verificationRoutes, publicVerificationRoutes } from './routes/verifications';
import searchRoutes from './routes/search';
import messageRoutes from './routes/messages';
import notificationRoutes from './routes/notifications';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(requestIdMiddleware as express.RequestHandler);

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

app.use('/api/v1', healthRoutes);

app.use('/api/v1/auctions', auctionRoutes);
app.use('/api/v1/settlements', settlementRoutes);
app.use('/api/v1/payouts', payoutRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/verifications', verificationRoutes);
app.use('/api/v1/verify', publicVerificationRoutes);
app.use('/api/v1/conversations', messageRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
app.use(errorHandler);

app.listen(PORT, () => {
  log.info('server_started', { port: PORT });
  console.log(`✅ Backend server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoints:`);
  console.log(`   GET  /api/v1/auctions/:id`);
  console.log(`   GET  /api/v1/auctions/:id/bids`);
  console.log(`   POST /api/v1/auctions/:id/bids`);
  console.log(`   POST /api/v1/webhooks/paymentcloud`);
  console.log(`🛡️  Admin endpoints:`);
  console.log(`   GET  /api/v1/admin/users`);
  console.log(`   POST /api/v1/admin/users/:userId/suspend`);
  console.log(`   POST /api/v1/admin/users/:userId/ban`);
  console.log(`   GET  /api/v1/admin/moderation/queue`);
  console.log(`   POST /api/v1/admin/moderation/queue/:queueId/resolve`);
  console.log(`   GET  /api/v1/admin/audit-logs`);
  console.log(`🔍 Search endpoints:`);
  console.log(`   GET    /api/v1/search`);
  console.log(`   GET    /api/v1/search/saved`);
  console.log(`   POST   /api/v1/search/saved`);
  console.log(`   DELETE /api/v1/search/saved/:id`);
  console.log(`💬 Messaging endpoints:`);
  console.log(`   GET    /api/v1/conversations`);
  console.log(`   POST   /api/v1/conversations/start`);
  console.log(`   GET    /api/v1/conversations/:id/messages`);
  console.log(`   POST   /api/v1/conversations/:id/messages`);
});
