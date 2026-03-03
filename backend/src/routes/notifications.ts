/**
 * notifications router — mounts at /api/v1/notifications.
 *
 * All routes require authentication via requireAuth middleware.
 *
 * GET    /                       — list paginated notifications
 * POST   /mark-all-read          — bulk mark unread as read
 * GET    /preferences            — fetch/upsert notification preferences
 * PUT    /preferences            — update notification preferences
 * PATCH  /:id/read               — mark a single notification as read
 *
 * @module routes/notifications
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listNotifications,
  markRead,
  markAllRead,
  getPreferences,
  updatePreferences,
} from '../controllers/notificationController';

const router = Router();

// Apply auth middleware to all notification routes
router.use(requireAuth as any);

// Static-path routes MUST be registered before /:id routes
router.get('/preferences', getPreferences as any);
router.put('/preferences', updatePreferences as any);
router.post('/mark-all-read', markAllRead as any);

// List notifications (with optional pagination and unread filter)
router.get('/', listNotifications as any);

// Mark a single notification as read
router.patch('/:id/read', markRead as any);

export default router;
