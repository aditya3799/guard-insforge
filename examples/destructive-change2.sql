-- Destructive Change on Existing Production Table
-- Modifies table temp_user_data that already exists in production database

-- 1. Destructive: Drop column from existing production table
ALTER TABLE temp_user_data DROP COLUMN session_token;

-- 2. Destructive: Remove all data from table
TRUNCATE TABLE temp_user_data;
