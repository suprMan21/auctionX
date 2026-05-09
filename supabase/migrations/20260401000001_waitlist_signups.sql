CREATE TABLE IF NOT EXISTS waitlist_signups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  source text NOT NULL DEFAULT 'collector',
  created_at timestamptz DEFAULT now()
);

-- Unique constraint on email
ALTER TABLE waitlist_signups ADD CONSTRAINT waitlist_signups_email_unique UNIQUE (email);

-- RLS
ALTER TABLE waitlist_signups ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (anonymous signup)
CREATE POLICY "Anyone can sign up for waitlist"
  ON waitlist_signups FOR INSERT
  WITH CHECK (true);

-- Only admins can read
CREATE POLICY "Admins can read waitlist"
  ON waitlist_signups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role::text IN ('admin', 'super_admin')
    )
  );
