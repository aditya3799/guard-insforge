-- Conflicting Database Schema Migration Example
-- Used for testing schema conflict detection logic

ALTER TABLE users ADD COLUMN id text;
