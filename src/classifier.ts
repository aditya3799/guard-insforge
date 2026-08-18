import * as fs from 'fs';

export type RiskCategory = 'SAFE' | 'DESTRUCTIVE' | 'REVIEW';

export interface ClassifiedStatement {
  index: number;
  rawSql: string;
  normalizedSql: string;
  category: RiskCategory;
  isSafe: boolean;
  matchedRule: string;
  reason: string;
}

export interface ClassificationResult {
  isSafe: boolean;
  verdict: 'SAFE' | 'DESTRUCTIVE' | 'NEEDS_REVIEW';
  summary: {
    totalStatements: number;
    safeCount: number;
    destructiveCount: number;
    reviewCount: number;
  };
  statements: ClassifiedStatement[];
  destructiveStatements: ClassifiedStatement[];
  reviewStatements: ClassifiedStatement[];
}

interface SafetyRule {
  name: string;
  category: RiskCategory;
  isSafe: boolean;
  pattern: RegExp;
  reason: string;
}

const DESTRUCTIVE_RULES: SafetyRule[] = [
  {
    name: 'DROP TABLE',
    category: 'DESTRUCTIVE',
    isSafe: false,
    pattern: /\bDROP\s+TABLE\b/i,
    reason: 'Destructive: Drops entire table and all containing data.'
  },
  {
    name: 'DROP COLUMN',
    category: 'DESTRUCTIVE',
    isSafe: false,
    pattern: /\bDROP\s+(?:COLUMN\b|CONSTRAINT\b|\b[a-zA-Z0-9_]+\b\s+FROM)/i,
    reason: 'Destructive: Drops column or constraint from existing table, risking data loss.'
  },
  {
    name: 'TRUNCATE',
    category: 'DESTRUCTIVE',
    isSafe: false,
    pattern: /\bTRUNCATE\b/i,
    reason: 'Destructive: Removes all rows from table.'
  },
  {
    name: 'ALTER COLUMN TYPE',
    category: 'DESTRUCTIVE',
    isSafe: false,
    pattern: /\bALTER\s+(?:COLUMN\s+)?[a-zA-Z0-9_]+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    reason: 'Destructive: Column data type alteration can result in data loss or casting errors.'
  },
  {
    name: 'DROP POLICY',
    category: 'DESTRUCTIVE',
    isSafe: false,
    pattern: /\bDROP\s+POLICY\b/i,
    reason: 'Destructive: Removes RLS policy, potentially opening security or authorization gaps.'
  }
];

const SAFE_RULES: SafetyRule[] = [
  {
    name: 'CREATE TABLE',
    category: 'SAFE',
    isSafe: true,
    pattern: /^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\b/i,
    reason: 'Safe: Additive table creation.'
  },
  {
    name: 'ADD COLUMN',
    category: 'SAFE',
    isSafe: true,
    pattern: /\bALTER\s+TABLE\s+.*\s+ADD\s+(?:COLUMN\s+)?[a-zA-Z0-9_]+/i,
    reason: 'Safe: Additive column addition.'
  },
  {
    name: 'CREATE INDEX',
    category: 'SAFE',
    isSafe: true,
    pattern: /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\b/i,
    reason: 'Safe: Additive index creation.'
  },
  {
    name: 'CREATE POLICY',
    category: 'SAFE',
    isSafe: true,
    pattern: /^\s*CREATE\s+POLICY\b/i,
    reason: 'Safe: Additive RLS policy addition.'
  }
];

/**
 * Strips single-line (`--`) and multi-line (`/* ... *\/`) comments from SQL string.
 */
export function stripSqlComments(sql: string): string {
  let cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  cleaned = cleaned.replace(/--.*$/gm, ' ');
  return cleaned;
}

/**
 * Splits raw SQL into individual statements by `;` semicolon boundaries.
 */
export function splitSqlStatements(sql: string): string[] {
  const cleaned = stripSqlComments(sql);
  return cleaned
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Classifies a single SQL statement based on deterministic safety rules.
 */
export function classifyStatement(statement: string, index: number = 0): ClassifiedStatement {
  const normalized = statement.replace(/\s+/g, ' ').trim();

  // 1. Check destructive rules first (highest priority)
  for (const rule of DESTRUCTIVE_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        index,
        rawSql: statement,
        normalizedSql: normalized,
        category: rule.category,
        isSafe: rule.isSafe,
        matchedRule: rule.name,
        reason: rule.reason
      };
    }
  }

  // 2. Check safe rules
  for (const rule of SAFE_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        index,
        rawSql: statement,
        normalizedSql: normalized,
        category: rule.category,
        isSafe: rule.isSafe,
        matchedRule: rule.name,
        reason: rule.reason
      };
    }
  }

  // 3. Fail closed: default to REVIEW for any unmatched syntax
  return {
    index,
    rawSql: statement,
    normalizedSql: normalized,
    category: 'REVIEW',
    isSafe: false,
    matchedRule: 'UNMATCHED_FAILS_CLOSED',
    reason: 'Review Required: Unmatched statement type default-to-review for safety.'
  };
}

/**
 * Evaluates full SQL content or diff file and produces a structured ClassificationResult.
 */
export function classifySql(sqlContent: string): ClassificationResult {
  const statements = splitSqlStatements(sqlContent);
  const classified = statements.map((stmt, idx) => classifyStatement(stmt, idx + 1));

  const destructiveStatements = classified.filter(c => c.category === 'DESTRUCTIVE');
  const reviewStatements = classified.filter(c => c.category === 'REVIEW');
  const safeStatements = classified.filter(c => c.category === 'SAFE');

  let verdict: 'SAFE' | 'DESTRUCTIVE' | 'NEEDS_REVIEW' = 'SAFE';
  if (destructiveStatements.length > 0) {
    verdict = 'DESTRUCTIVE';
  } else if (reviewStatements.length > 0) {
    verdict = 'NEEDS_REVIEW';
  }

  const isSafe = verdict === 'SAFE';

  return {
    isSafe,
    verdict,
    summary: {
      totalStatements: classified.length,
      safeCount: safeStatements.length,
      destructiveCount: destructiveStatements.length,
      reviewCount: reviewStatements.length
    },
    statements: classified,
    destructiveStatements,
    reviewStatements
  };
}

/**
 * Reads SQL file from disk and returns classification result.
 */
export function classifySqlFile(filePath: string): ClassificationResult {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL file not found at path: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return classifySql(content);
}
