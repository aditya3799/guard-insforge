-- Destructive Database Schema Migration Example
-- Features: DROP COLUMN, TRUNCATE TABLE

-- 1. Destructive: Drop column from demo_accounts table
ALTER TABLE demo_accounts DROP COLUMN IF EXISTS role;

-- 2. Destructive: Truncate demo_tasks table
TRUNCATE TABLE demo_tasks;


