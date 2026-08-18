-- Destructive Database Schema Migration Example
-- Features: DROP COLUMN, TRUNCATE TABLE, ALTER COLUMN TYPE

-- 1. Setup table in current migration context:
CREATE TABLE IF NOT EXISTS temp_user_data (
    id UUID PRIMARY KEY,
    phone_number TEXT,
    session_token TEXT,
    amount NUMERIC
);

-- 2. Destructive: Drop column from active table
ALTER TABLE temp_user_data DROP COLUMN phone_number;

-- 3. Destructive: Remove all data from table
TRUNCATE TABLE temp_user_data;

-- 4. Destructive: Change column data type
ALTER TABLE temp_user_data ALTER COLUMN amount TYPE INTEGER;
