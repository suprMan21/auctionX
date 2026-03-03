/**
 * messagingController — buyer/seller messaging
 *
 * Routes:
 *   GET  /api/v1/conversations                 — list user's conversations (auth)
 *   POST /api/v1/conversations/start           — start a new conversation (auth)
 *   GET  /api/v1/conversations/:id/messages    — fetch messages + mark read (auth)
 *   POST /api/v1/conversations/:id/messages    — send a message (auth)
 *
 * Auth:
 *   All handlers require requireAuth middleware (applied in route file).
 *
 * Notes:
 *   - Service client bypasses RLS; participant checks done manually.
 *   - Participant order normalised (lower UUID first) for UNIQUE constraint.
 *   - filterMessage() blocks off-platform payment/contact attempts.
 */
import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { filterMessage } from '../lib/moderation/messageFilter';

interface ConversationRequest extends Request, RequestWithId, AuthRequest {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

const MAX_BODY_LENGTH = 2000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function validateBody(body: unknown): string {
  if (typeof body !== 'string' || !body.trim()) {
    throw new AppError('invalid_argument', 'Message body is required');
  }
  if (body.trim().length > MAX_BODY_LENGTH) {
    throw new AppError('invalid_argument', `Message body must not exceed ${MAX_BODY_LENGTH} characters`);
  }
  return body.trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/v1/conversations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * List all conversations for the authenticated user.
 * Returns conversations with other-participant info, listing title, and unread count.
 */
export const listConversations = async (req: ConversationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const supabase = getServiceClient();

    // Fetch conversations where the user is a participant, with listing context
    const { data: conversations, error } = await supabase
      .from('conversations')
      .select(`
        id,
        listing_id,
        participant_1_id,
        participant_2_id,
        last_message_at,
        last_message_preview,
        created_at,
        updated_at,
        listings(id, title)
      `)
      .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (error) {
      logger.error('list_conversations_failed', { userId, error: error.message });
      throw new AppError('internal', 'Failed to fetch conversations');
    }

    if (!conversations || conversations.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Collect the other participants' IDs
    const otherUserIds = conversations.map((c) =>
      c.participant_1_id === userId ? c.participant_2_id : c.participant_1_id
    );
    const uniqueOtherIds = [...new Set(otherUserIds)];

    // Fetch other participants' profiles
    const { data: otherUsers, error: usersError } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .in('id', uniqueOtherIds);

    if (usersError) {
      logger.error('list_conversations_users_failed', { userId, error: usersError.message });
      throw new AppError('internal', 'Failed to fetch participant profiles');
    }

    const userMap = new Map((otherUsers ?? []).map((u) => [u.id, u]));

    // Fetch unread counts per conversation
    const { data: unreadRows, error: unreadError } = await supabase
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', conversations.map((c) => c.id))
      .is('read_at', null)
      .neq('sender_id', userId);

    if (unreadError) {
      // Non-fatal — degrade gracefully
      logger.error('list_conversations_unread_failed', { userId, error: unreadError.message });
    }

    // Build unread count map
    const unreadMap = new Map<string, number>();
    for (const row of (unreadRows ?? [])) {
      const convId = row.conversation_id as string;
      unreadMap.set(convId, (unreadMap.get(convId) ?? 0) + 1);
    }

    const result = conversations.map((c) => {
      const otherId = c.participant_1_id === userId ? c.participant_2_id : c.participant_1_id;
      const otherUser = userMap.get(otherId) ?? null;
      return {
        ...c,
        other_participant: otherUser,
        unread_count: unreadMap.get(c.id) ?? 0,
      };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/v1/conversations/:id/messages
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fetch paginated messages for a conversation and mark them as read.
 * User must be a participant. Messages ordered oldest-first.
 */
export const getMessages = async (req: ConversationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const { id } = req.params;
    if (!id) throw new AppError('invalid_argument', 'Conversation id is required');

    const pageParam = String(req.query['page'] ?? '1');
    const limitParam = String(req.query['limit'] ?? String(DEFAULT_LIMIT));
    const page = Math.max(1, parseInt(pageParam, 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(limitParam, 10) || DEFAULT_LIMIT));
    const from = (page - 1) * limit;

    const supabase = getServiceClient();

    // Verify participation
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('id, participant_1_id, participant_2_id')
      .eq('id', id)
      .maybeSingle();

    if (convError || !conv) {
      throw new AppError('not_found', 'Conversation not found');
    }
    if (conv.participant_1_id !== userId && conv.participant_2_id !== userId) {
      throw new AppError('permission_denied', 'You are not a participant in this conversation');
    }

    // Fetch messages (oldest first for chat display)
    const { data: messages, error: msgError, count } = await supabase
      .from('messages')
      .select('*', { count: 'exact' })
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .range(from, from + limit - 1);

    if (msgError) {
      logger.error('get_messages_failed', { userId, convId: id, error: msgError.message });
      throw new AppError('internal', 'Failed to fetch messages');
    }

    // Mark unread messages from the other participant as read (non-fatal)
    supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', id)
      .neq('sender_id', userId)
      .is('read_at', null)
      .then(({ error: readError }) => {
        if (readError) {
          logger.error('mark_read_failed', { userId, convId: id, error: readError.message });
        }
      });

    return res.json({
      success: true,
      data: {
        messages: messages ?? [],
        total: count ?? 0,
        page,
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/v1/conversations/:id/messages
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Send a message in an existing conversation.
 * Verifies participation, validates + filters body, then inserts.
 */
export const sendMessage = async (req: ConversationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const { id } = req.params;
    if (!id) throw new AppError('invalid_argument', 'Conversation id is required');

    const body = validateBody((req.body as Record<string, unknown>).body);

    const filterResult = filterMessage(body);
    if (!filterResult.allowed) {
      return res.status(400).json({ success: false, error: filterResult.reason });
    }

    const supabase = getServiceClient();

    // Verify participation
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('id, participant_1_id, participant_2_id')
      .eq('id', id)
      .maybeSingle();

    if (convError || !conv) {
      throw new AppError('not_found', 'Conversation not found');
    }
    if (conv.participant_1_id !== userId && conv.participant_2_id !== userId) {
      throw new AppError('permission_denied', 'You are not a participant in this conversation');
    }

    const { data: message, error: insertError } = await supabase
      .from('messages')
      .insert({
        conversation_id: id,
        sender_id: userId,
        body,
      })
      .select()
      .single();

    if (insertError) {
      logger.error('send_message_failed', { userId, convId: id, error: insertError.message });
      throw new AppError('internal', 'Failed to send message');
    }

    return res.status(201).json({ success: true, data: message });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/v1/conversations/start
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Start a new conversation (or reuse existing one) with an opening message.
 * Participant order is normalised to lower UUID first for UNIQUE constraint.
 */
export const startConversation = async (req: ConversationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const { listingId, recipientId, body: rawBody } = req.body as {
      listingId?: string;
      recipientId?: string;
      body?: unknown;
    };

    if (!listingId || typeof listingId !== 'string') {
      throw new AppError('invalid_argument', 'listingId is required');
    }
    if (!recipientId || typeof recipientId !== 'string') {
      throw new AppError('invalid_argument', 'recipientId is required');
    }
    if (recipientId === userId) {
      throw new AppError('invalid_argument', 'You cannot message yourself');
    }

    const body = validateBody(rawBody);

    const filterResult = filterMessage(body);
    if (!filterResult.allowed) {
      return res.status(400).json({ success: false, error: filterResult.reason });
    }

    const supabase = getServiceClient();

    // Normalise participant order: lower UUID string first → consistent UNIQUE key
    const [p1, p2] = userId < recipientId
      ? [userId, recipientId]
      : [recipientId, userId];

    // Upsert conversation: INSERT on conflict do nothing, then SELECT
    const { error: upsertError } = await supabase
      .from('conversations')
      .insert({
        listing_id: listingId,
        participant_1_id: p1,
        participant_2_id: p2,
      })
      .select()
      .single();

    // UNIQUE violation (code 23505) is expected when conversation already exists
    if (upsertError && upsertError.code !== '23505') {
      logger.error('start_conversation_upsert_failed', { userId, error: upsertError.message });
      throw new AppError('internal', 'Failed to create conversation');
    }

    // Now fetch the conversation (whether newly created or already existing)
    const { data: conversation, error: fetchError } = await supabase
      .from('conversations')
      .select('*')
      .eq('listing_id', listingId)
      .eq('participant_1_id', p1)
      .eq('participant_2_id', p2)
      .single();

    if (fetchError || !conversation) {
      logger.error('start_conversation_fetch_failed', { userId, error: fetchError?.message });
      throw new AppError('internal', 'Failed to retrieve conversation');
    }

    // Insert the opening message
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_id: userId,
        body,
      })
      .select()
      .single();

    if (msgError) {
      logger.error('start_conversation_message_failed', {
        userId,
        convId: conversation.id,
        error: msgError.message,
      });
      throw new AppError('internal', 'Failed to send opening message');
    }

    return res.status(201).json({ success: true, data: { conversation, message } });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
