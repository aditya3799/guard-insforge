-- Safe Database Schema Migration Example
-- Features: CREATE TABLE, ADD COLUMN, CREATE INDEX, CREATE POLICY

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY,
    theme VARCHAR(50) DEFAULT 'dark',
    notifications_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS locale VARCHAR(10) DEFAULT 'en-US';

CREATE INDEX IF NOT EXISTS idx_user_prefs_theme ON user_preferences(theme);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own preferences" ON user_preferences
    FOR ALL USING (auth.uid() = user_id);
