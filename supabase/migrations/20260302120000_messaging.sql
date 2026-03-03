-- Module 15: Messaging System
-- Creates conversations and messages tables with RLS, indexes, and Realtime.

-- ─── A. conversations table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."conversations" (
  "id" UUID DEFAULT gen_random_uuid() NOT NULL,
  "listing_id" UUID NOT NULL REFERENCES "public"."listings"("id") ON DELETE CASCADE,
  "participant_1_id" UUID NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "participant_2_id" UUID NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "last_message_at" TIMESTAMPTZ,
  "last_message_preview" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  "updated_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversations_unique_participants" UNIQUE ("listing_id", "participant_1_id", "participant_2_id")
);

ALTER TABLE "public"."conversations" OWNER TO "postgres";

CREATE TRIGGER "set_updated_at_conversations"
  BEFORE UPDATE ON "public"."conversations"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

-- ─── B. messages table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."messages" (
  "id" UUID DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" UUID NOT NULL REFERENCES "public"."conversations"("id") ON DELETE CASCADE,
  "sender_id" UUID NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "body" TEXT NOT NULL,
  "read_at" TIMESTAMPTZ,
  "flagged" BOOLEAN DEFAULT false NOT NULL,
  "flagged_reason" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."messages" OWNER TO "postgres";

-- ─── C. Trigger: keep conversations.last_message_at and preview in sync ─────

CREATE OR REPLACE FUNCTION "public"."update_conversation_on_message"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $body$
BEGIN
  UPDATE public.conversations
  SET
    last_message_at      = NEW.created_at,
    last_message_preview = LEFT(NEW.body, 120),
    updated_at           = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$body$;

CREATE TRIGGER "messages_update_conversation"
  AFTER INSERT ON "public"."messages"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_conversation_on_message"();

-- ─── D. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_conversations_participant_1"
  ON "public"."conversations" ("participant_1_id");

CREATE INDEX IF NOT EXISTS "idx_conversations_participant_2"
  ON "public"."conversations" ("participant_2_id");

CREATE INDEX IF NOT EXISTS "idx_conversations_last_message_at"
  ON "public"."conversations" ("last_message_at" DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS "idx_messages_conversation_id"
  ON "public"."messages" ("conversation_id");

CREATE INDEX IF NOT EXISTS "idx_messages_sender_id"
  ON "public"."messages" ("sender_id");

CREATE INDEX IF NOT EXISTS "idx_messages_unread"
  ON "public"."messages" ("conversation_id", "read_at")
  WHERE read_at IS NULL;

-- ─── E. RLS policies ─────────────────────────────────────────────────────────

ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_participant_read"
  ON "public"."conversations"
  FOR SELECT
  USING (
    auth.uid() = participant_1_id
    OR auth.uid() = participant_2_id
  );

CREATE POLICY "conversations_participant_insert"
  ON "public"."conversations"
  FOR INSERT
  WITH CHECK (
    auth.uid() = participant_1_id
    OR auth.uid() = participant_2_id
  );

ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_participant_read"
  ON "public"."messages"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.participant_1_id = auth.uid() OR c.participant_2_id = auth.uid())
    )
  );

CREATE POLICY "messages_participant_insert"
  ON "public"."messages"
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.participant_1_id = auth.uid() OR c.participant_2_id = auth.uid())
    )
  );

-- UPDATE policy: allows setting read_at (for read receipts) by the OTHER participant
CREATE POLICY "messages_participant_update"
  ON "public"."messages"
  FOR UPDATE
  USING (
    sender_id != auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.participant_1_id = auth.uid() OR c.participant_2_id = auth.uid())
    )
  );

-- ─── F. Grants ───────────────────────────────────────────────────────────────

GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";

GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";

-- ─── G. Realtime ─────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
