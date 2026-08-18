-- Destructive Database Schema Migration Example
-- Features: DROP COLUMN, TRUNCATE TABLE, DROP POLICY, ALTER COLUMN TYPE

-- 1. Destructive: Drop column from active table
ALTER TABLE users DROP COLUMN phone_number;

-- 2. Destructive: Remove all data from table
TRUNCATE TABLE session_cache;

-- 3. Destructive: Remove security policy
DROP POLICY "public_read_access" ON products;

-- 4. Destructive: Change column data type
ALTER TABLE orders ALTER COLUMN total_amount TYPE INTEGER;
