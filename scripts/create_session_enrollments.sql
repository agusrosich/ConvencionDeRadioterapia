-- Run this in Supabase SQL Editor to create the session_enrollments table
-- This table stores user inscriptions to convention sessions (mesas)

CREATE TABLE IF NOT EXISTS session_enrollments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_key text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(session_key, user_id)
);

-- Enable Row Level Security
ALTER TABLE session_enrollments ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read all enrollments (to see counts and who is enrolled)
CREATE POLICY "Anyone can read enrollments"
  ON session_enrollments FOR SELECT
  USING (true);

-- Users can only insert their own enrollments
CREATE POLICY "Users can insert own enrollments"
  ON session_enrollments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own enrollments
CREATE POLICY "Users can delete own enrollments"
  ON session_enrollments FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast lookups by session_key
CREATE INDEX IF NOT EXISTS idx_session_enrollments_session_key
  ON session_enrollments(session_key);

-- Index for fast lookups by user_id
CREATE INDEX IF NOT EXISTS idx_session_enrollments_user_id
  ON session_enrollments(user_id);
