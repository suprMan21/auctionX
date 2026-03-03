/**
 * messages routes — mounted at /api/v1/conversations
 *
 * All routes require authentication.
 *   GET  /                  → listConversations
 *   POST /start             → startConversation
 *   GET  /:id/messages      → getMessages
 *   POST /:id/messages      → sendMessage
 */
import { Router, RequestHandler } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listConversations,
  startConversation,
  getMessages,
  sendMessage,
} from '../controllers/messagingController';

const router = Router();

router.get('/', requireAuth, listConversations as unknown as RequestHandler);
router.post('/start', requireAuth, startConversation as unknown as RequestHandler);
router.get('/:id/messages', requireAuth, getMessages as unknown as RequestHandler);
router.post('/:id/messages', requireAuth, sendMessage as unknown as RequestHandler);

export default router;
