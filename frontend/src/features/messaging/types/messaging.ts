/**
 * Messaging types for Module 15.
 *
 * Note: `conversations` and `messages` tables are added in migration
 * 20260302120000_messaging.sql but DB types have not been regenerated yet.
 * Use `as unknown` casts at call sites until `npx supabase db push` +
 * type regen is run.
 */

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  flagged: boolean;
  flagged_reason: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  listing_id: string;
  participant_1_id: string;
  participant_2_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParticipantProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface ListingRef {
  id: string;
  title: string;
}

/** Conversation enriched with other-participant profile and unread count. */
export interface ConversationWithDetails extends Conversation {
  other_participant: ParticipantProfile | null;
  unread_count: number;
  listings: ListingRef | ListingRef[] | null;
}

export interface MessagesResponse {
  messages: Message[];
  total: number;
  page: number;
}

export interface StartConversationResponse {
  conversation: Conversation;
  message: Message;
}
