-- Add bio and profile_photo_url columns to users table
-- These support the ProfilePage bio/photo features
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
