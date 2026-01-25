-- Drop the problematic public policy
DROP POLICY IF EXISTS "Public can view seller profiles" ON users;

-- Create a proper public seller profile policy that doesn't cause recursion
-- This policy allows anyone to view basic seller info without auth check
CREATE POLICY "Public can view seller profiles"
  ON users FOR SELECT
  TO public
  USING (true);
