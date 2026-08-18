import { classifySql, classifyStatement } from '../src/classifier';
import * as assert from 'assert';

console.log('🧪 Running Agent Change Guard Classifier Unit Tests...\n');

let passed = 0;
let total = 0;

function test(name: string, fn: () => void) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// 1. Safe statements test
test('Classifies CREATE TABLE as SAFE', () => {
  const res = classifyStatement('CREATE TABLE users (id uuid primary key, name text);');
  assert.strictEqual(res.isSafe, true);
  assert.strictEqual(res.category, 'SAFE');
  assert.strictEqual(res.matchedRule, 'CREATE TABLE');
});

test('Classifies ADD COLUMN as SAFE', () => {
  const res = classifyStatement('ALTER TABLE users ADD COLUMN email text;');
  assert.strictEqual(res.isSafe, true);
  assert.strictEqual(res.category, 'SAFE');
  assert.strictEqual(res.matchedRule, 'ADD COLUMN');
});

test('Classifies CREATE INDEX as SAFE', () => {
  const res = classifyStatement('CREATE UNIQUE INDEX idx_users_email ON users(email);');
  assert.strictEqual(res.isSafe, true);
  assert.strictEqual(res.category, 'SAFE');
  assert.strictEqual(res.matchedRule, 'CREATE INDEX');
});

test('Classifies CREATE POLICY as SAFE', () => {
  const res = classifyStatement('CREATE POLICY "user_self_access" ON users FOR SELECT USING (auth.uid() = id);');
  assert.strictEqual(res.isSafe, true);
  assert.strictEqual(res.category, 'SAFE');
  assert.strictEqual(res.matchedRule, 'CREATE POLICY');
});

test('Classifies BEGIN and COMMIT as SAFE TRANSACTION CONTROL', () => {
  const res1 = classifyStatement('BEGIN;');
  assert.strictEqual(res1.isSafe, true);
  assert.strictEqual(res1.matchedRule, 'TRANSACTION CONTROL');

  const res2 = classifyStatement('COMMIT;');
  assert.strictEqual(res2.isSafe, true);
  assert.strictEqual(res2.matchedRule, 'TRANSACTION CONTROL');
});

// 2. Destructive statements test
test('Classifies DROP TABLE as DESTRUCTIVE', () => {
  const res = classifyStatement('DROP TABLE sensitive_logs;');
  assert.strictEqual(res.isSafe, false);
  assert.strictEqual(res.category, 'DESTRUCTIVE');
  assert.strictEqual(res.matchedRule, 'DROP TABLE');
});

test('Classifies DROP COLUMN as DESTRUCTIVE', () => {
  const res = classifyStatement('ALTER TABLE users DROP COLUMN phone_number;');
  assert.strictEqual(res.isSafe, false);
  assert.strictEqual(res.category, 'DESTRUCTIVE');
  assert.strictEqual(res.matchedRule, 'DROP COLUMN');
});

test('Classifies TRUNCATE as DESTRUCTIVE', () => {
  const res = classifyStatement('TRUNCATE TABLE active_sessions;');
  assert.strictEqual(res.isSafe, false);
  assert.strictEqual(res.category, 'DESTRUCTIVE');
  assert.strictEqual(res.matchedRule, 'TRUNCATE');
});

test('Classifies ALTER COLUMN TYPE as DESTRUCTIVE', () => {
  const res = classifyStatement('ALTER TABLE orders ALTER COLUMN amount TYPE integer;');
  assert.strictEqual(res.isSafe, false);
  assert.strictEqual(res.category, 'DESTRUCTIVE');
  assert.strictEqual(res.matchedRule, 'ALTER COLUMN TYPE');
});

test('Classifies DROP POLICY as DESTRUCTIVE', () => {
  const res = classifyStatement('DROP POLICY "public_read" ON products;');
  assert.strictEqual(res.isSafe, false);
  assert.strictEqual(res.category, 'DESTRUCTIVE');
  assert.strictEqual(res.matchedRule, 'DROP POLICY');
});

// 3. Fail closed review test
test('Fails closed on RENAME COLUMN to NEEDS_REVIEW', () => {
  const res = classifyStatement('ALTER TABLE users RENAME COLUMN username TO handle;');
  assert.strictEqual(res.isSafe, false);
  assert.strictEqual(res.category, 'REVIEW');
  assert.strictEqual(res.matchedRule, 'UNMATCHED_FAILS_CLOSED');
});

// 4. Batch SQL file classification
test('Full SQL script classification - Safe Script', () => {
  const sql = `
    -- Safe Schema Migration
    CREATE TABLE products (
      id uuid PRIMARY KEY,
      title text NOT NULL
    );

    ALTER TABLE products ADD COLUMN price numeric;
    CREATE INDEX idx_products_title ON products(title);
  `;
  const result = classifySql(sql);
  assert.strictEqual(result.isSafe, true);
  assert.strictEqual(result.verdict, 'SAFE');
  assert.strictEqual(result.summary.totalStatements, 3);
  assert.strictEqual(result.summary.destructiveCount, 0);
});

test('Full SQL script classification - Destructive Script', () => {
  const sql = `
    CREATE TABLE audit_logs (id uuid PRIMARY KEY);
    ALTER TABLE users DROP COLUMN ssn;
    TRUNCATE TABLE temporary_tokens;
  `;
  const result = classifySql(sql);
  assert.strictEqual(result.isSafe, false);
  assert.strictEqual(result.verdict, 'DESTRUCTIVE');
  assert.strictEqual(result.summary.destructiveCount, 2);
  assert.strictEqual(result.destructiveStatements.length, 2);
});

console.log(`\nResults: ${passed}/${total} tests passed.`);
if (passed !== total) {
  process.exit(1);
}
