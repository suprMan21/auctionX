import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { requestIdMiddleware } from './middleware/requestId';
import { log } from './lib/logger';
import auctionRoutes from './routes/auctions';
import paymentRoutes from './routes/payments';
import webhookRoutes from './routes/webhooks';
import adminRoutes from './routes/admin/index';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(requestIdMiddleware as express.RequestHandler);

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/v1/auctions', auctionRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/admin', adminRoutes);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  log.error('unhandled_error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, () => {
  log.info('server_started', { port: PORT });
  console.log(`✅ Backend server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoints:`);
  console.log(`   GET  /api/v1/auctions/:id`);
  console.log(`   GET  /api/v1/auctions/:id/bids`);
  console.log(`   POST /api/v1/auctions/:id/bids`);
  console.log(`   POST /api/v1/payments/auctions/:auctionId/payment`);
  console.log(`   GET  /api/v1/payments/transactions/:transactionId`);
  console.log(`   POST /api/v1/webhooks/paymentcloud`);
  console.log(`🛡️  Admin endpoints:`);
  console.log(`   GET  /api/v1/admin/users`);
  console.log(`   POST /api/v1/admin/users/:userId/suspend`);
  console.log(`   POST /api/v1/admin/users/:userId/ban`);
  console.log(`   GET  /api/v1/admin/moderation/queue`);
  console.log(`   POST /api/v1/admin/moderation/queue/:queueId/resolve`);
  console.log(`   GET  /api/v1/admin/audit-logs`);
});
