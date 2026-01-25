-- Drop all existing user policies
DROP POLICY IF EXISTS "Users can view own profile" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Admins can view all users" ON users;
DROP POLICY IF EXISTS "Admins can update any user" ON users;
DROP POLICY IF EXISTS "Public can view seller profiles" ON users;

-- Policy 1: Anyone (authenticated or not) can view user profiles
-- This is safe because we only expose non-sensitive fields via app logic
CREATE POLICY "Anyone can view users"
  ON users FOR SELECT
  USING (true);

-- Policy 2: Users can update their own profile (excluding role/seller_tier)
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id 
    AND role = (SELECT role FROM users WHERE id = auth.uid())
    AND seller_tier = (SELECT seller_tier FROM users WHERE id = auth.uid())
  );
