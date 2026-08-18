-- Destructive Database Schema Migration Example
-- Features: DROP COLUMN, TRUNCATE TABLE

-- 1. Ensure prerequisite demo tables exist:
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    role TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY,
    title TEXT
);

-- 2. Destructive: Drop column from users table
ALTER TABLE users DROP COLUMN IF EXISTS role;

-- 3. Destructive: Truncate tasks table
TRUNCATE TABLE tasks;
