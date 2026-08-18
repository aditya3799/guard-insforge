-- Destructive Database Schema Migration Example
-- Features: DROP COLUMN, TRUNCATE TABLE, ALTER COLUMN TYPE

-- 1. Setup prerequisite demo tables (safe additive setup):
CREATE TABLE IF NOT EXISTS demo_users (
    id UUID PRIMARY KEY,
    phone_number TEXT
);

CREATE TABLE IF NOT EXISTS session_cache (
    id UUID PRIMARY KEY,
    token TEXT
);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY,
    total_amount NUMERIC
);

-- 2. Destructive: Drop column from active table
ALTER TABLE demo_users DROP COLUMN phone_number;

-- 3. Destructive: Remove all data from table
TRUNCATE TABLE session_cache;

-- 4. Destructive: Change column data type
ALTER TABLE orders ALTER COLUMN total_amount TYPE INTEGER;
