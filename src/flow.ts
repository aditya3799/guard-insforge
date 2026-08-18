import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';
import {
  createBranch,
  applySqlToBranch,
  mergeDryRun,
  mergeReal,
  deleteBranch,
  resetBranch,
  isInsForgeAuthenticated,
  BranchOpOptions
} from './branchOps';
import { classifySqlFile, ClassificationResult } from './classifier';

export interface ApplyFlowOptions extends BranchOpOptions {
  cleanup?: boolean;
}

export interface FlowResult {
  success: boolean;
  outcome: 'AUTO_MERGED' | 'HELD_FOR_APPROVAL' | 'MERGE_CONFLICT' | 'ERROR';
  exitCode: number;
  message: string;
  diffPath?: string;
  classification?: ClassificationResult;
}

/**
 * Resolves whether to use real InsForge CLI execution or auto-fallback to mock mode.
 */
function resolveExecutionOptions<T extends BranchOpOptions>(options: T): T {
  const forceMock = options.mock === true || !!process.env.GUARD_MOCK;
  if (forceMock) {
    return { ...options, mock: true };
  }

  const authenticated = isInsForgeAuthenticated();
  if (!authenticated) {
    console.log(pc.yellow(
      '⚠️  No InsForge login detected — automatically running in mock mode.\n' +
      '   To test against a real project: npx @insforge/cli login\n' +
      '   See README for full setup.\n'
    ));
    return { ...options, mock: true };
  }

  return options;
}

/**
 * Orchestrates: create -> apply -> dry-run -> classify -> merge or hold
 */
export function applyFlow(changeName: string, sqlPath: string, options: ApplyFlowOptions = {}): FlowResult {
  const resolvedOpts = resolveExecutionOptions(options);

  console.log(pc.cyan(`\n🛡️  InsForge Agent Change Guard — Evaluating Proposed Change: "${changeName}"`));
  console.log(pc.dim(`   SQL File: ${sqlPath}\n`));

  if (!fs.existsSync(sqlPath)) {
    const msg = `SQL file not found at path: ${sqlPath}`;
    console.error(pc.red(`❌ Error: ${msg}`));
    return { success: false, outcome: 'ERROR', exitCode: 1, message: msg };
  }

  // Ensure output directory for dry-run SQL diffs
  const diffDir = path.join(process.cwd(), '.guard-diffs');
  if (!fs.existsSync(diffDir)) {
    fs.mkdirSync(diffDir, { recursive: true });
  }
  const diffPath = path.join(diffDir, `${changeName}.diff.sql`);

  // Step 1: Create isolated branch
  console.log(pc.blue(`1️⃣  Creating isolated database branch: "${changeName}"...`));
  const createRes = createBranch(changeName, sqlPath, resolvedOpts);
  if (createRes.exitCode !== 0) {
    if (createRes.isConflict) {
      console.log(pc.yellow(`⚠️  Branch "${changeName}" already exists or limit reached.`));
    } else {
      console.error(pc.red(`❌ Failed to create branch: ${createRes.stderr}`));
      return { success: false, outcome: 'ERROR', exitCode: 1, message: createRes.stderr };
    }
  }

  // Step 2: Apply SQL changes on branch
  console.log(pc.blue(`2️⃣  Applying SQL schema changes on branch "${changeName}"...`));
  const applyRes = applySqlToBranch(changeName, sqlPath, resolvedOpts);
  if (applyRes.exitCode !== 0) {
    console.error(pc.red(`❌ Failed to apply SQL script on branch: ${applyRes.stderr}`));
    return { success: false, outcome: 'ERROR', exitCode: 1, message: applyRes.stderr };
  }

  // Step 3: Run dry-run merge to generate real SQL diff
  console.log(pc.blue(`3️⃣  Executing dry-run merge to capture SQL diff...`));
  const dryRunRes = mergeDryRun(changeName, diffPath, sqlPath, resolvedOpts);

  // Handle Schema Merge Conflicts distinctly
  if (dryRunRes.exitCode !== 0 || dryRunRes.isConflict) {
    console.log('\n' + pc.bgRed(pc.white(pc.bold(' ⚡ MERGE CONFLICT DETECTED '))) + '\n');
    console.log(pc.red(`Merge failed due to database schema conflict with production:`));
    console.log(pc.dim(`   ${dryRunRes.stderr || dryRunRes.stdout}\n`));

    console.log(pc.yellow(`ℹ️  This is a DB schema conflict, NOT a safety classification verdict.`));
    console.log(pc.cyan(`Next Steps / Human Options:`));
    console.log(`  1. Switch to branch and resolve manually:  ${pc.bold(`insforge branch switch ${changeName}`)}`);
    console.log(`  2. Reset branch & retry from scratch:      ${pc.bold(`insforge branch reset ${changeName}`)}`);
    console.log(`  3. Cleanup/delete branch:                  ${pc.bold(`guard cleanup ${changeName}`)}\n`);

    return {
      success: false,
      outcome: 'MERGE_CONFLICT',
      exitCode: 2,
      message: 'Branch blocked by schema merge conflict.',
      diffPath
    };
  }

  // Step 4: Classify dry-run SQL diff statement-by-statement
  console.log(pc.blue(`4️⃣  Classifying SQL diff via deterministic risk rules...`));
  const classification = classifySqlFile(diffPath);

  // Step 5: Decision logic
  if (classification.isSafe) {
    console.log('\n' + pc.bgGreen(pc.black(pc.bold(' ✅ SAFE CHANGE CLASSIFIED — AUTO-MERGING '))) + '\n');
    console.log(pc.green(`Summary:`));
    console.log(`   Total Statements: ${classification.summary.totalStatements}`);
    console.log(`   Safe Statements:  ${pc.green(classification.summary.safeCount)}`);
    console.log(`   Destructive:      ${classification.summary.destructiveCount}`);
    console.log(`   Review Required:  ${classification.summary.reviewCount}\n`);

    classification.statements.forEach(stmt => {
      console.log(`   ${pc.green('✓')} [${stmt.matchedRule}] ${pc.dim(stmt.normalizedSql.substring(0, 70))}`);
    });

    console.log(pc.blue(`\n🚀 Merging branch "${changeName}" into parent production database...`));
    const mergeRes = mergeReal(changeName, resolvedOpts);
    if (mergeRes.exitCode !== 0) {
      console.error(pc.red(`❌ Auto-merge failed: ${mergeRes.stderr}`));
      return { success: false, outcome: 'ERROR', exitCode: 1, message: mergeRes.stderr, classification, diffPath };
    }

    console.log(pc.green(`\n✨ Branch "${changeName}" successfully merged to production!`));

    if (resolvedOpts.cleanup) {
      deleteBranch(changeName, resolvedOpts);
      console.log(pc.dim(`🧹 Cleaned up branch "${changeName}".`));
    }

    return {
      success: true,
      outcome: 'AUTO_MERGED',
      exitCode: 0,
      message: 'Change is safe and was automatically merged.',
      classification,
      diffPath
    };
  } else {
    // Destructive or Review required
    const isDestructive = classification.verdict === 'DESTRUCTIVE';
    const bannerText = isDestructive
      ? ' 🛑 DESTRUCTIVE SCHEMA CHANGE DETECTED — BRANCH HELD '
      : ' ⚠️  UNMATCHED STATEMENT TYPE — HELD FOR SAFETY REVIEW ';

    console.log('\n' + pc.bgRed(pc.white(pc.bold(bannerText))) + '\n');
    console.log(pc.yellow(`Branch Status: `) + pc.bold(`HELD ON INSFORGE (Not Merged)`));
    console.log(pc.red(`Verdict: `) + pc.bold(classification.verdict));
    console.log(`Summary:`);
    console.log(`   Total Statements: ${classification.summary.totalStatements}`);
    console.log(`   Safe Statements:  ${classification.summary.safeCount}`);
    console.log(`   Destructive:      ${pc.red(classification.summary.destructiveCount)}`);
    console.log(`   Review Required:  ${pc.yellow(classification.summary.reviewCount)}\n`);

    console.log(pc.bold(`Flagged Statements:`));
    const flagged = [...classification.destructiveStatements, ...classification.reviewStatements];
    flagged.forEach(stmt => {
      const color = stmt.category === 'DESTRUCTIVE' ? pc.red : pc.yellow;
      console.log(`  ${color('🚨')} [Stmt #${stmt.index}] ${pc.bold(stmt.matchedRule)}`);
      console.log(`     SQL:    ${pc.dim(stmt.normalizedSql)}`);
      console.log(`     Reason: ${stmt.reason}`);
    });

    console.log('\n' + pc.bold(pc.cyan('🔒 HUMAN APPROVAL REQUIRED')));
    console.log(`This proposed change was stopped before touching production.`);
    console.log(`To inspect the isolated branch or approve the merge, execute:\n`);
    console.log(`   ${pc.bold(pc.green(`guard approve ${changeName}`))}`);
    console.log(`   OR explicitly shell out to InsForge CLI:`);
    console.log(`   ${pc.bold(`npx @insforge/cli branch merge ${changeName}`)}\n`);

    return {
      success: false,
      outcome: 'HELD_FOR_APPROVAL',
      exitCode: 1,
      message: `Branch held due to ${classification.verdict} classification. Human approval required.`,
      classification,
      diffPath
    };
  }
}

/**
 * Manually approves and merges a held branch.
 */
export function approveFlow(changeName: string, options: BranchOpOptions = {}): FlowResult {
  const resolvedOpts = resolveExecutionOptions(options);
  console.log(pc.cyan(`\n👍 Approving and merging held branch "${changeName}"...`));
  const res = mergeReal(changeName, resolvedOpts);

  if (res.exitCode !== 0) {
    console.error(pc.red(`❌ Failed to merge branch "${changeName}": ${res.stderr || res.stdout}`));
    return { success: false, outcome: 'ERROR', exitCode: 1, message: res.stderr || res.stdout };
  }

  console.log(pc.green(`\n🎉 Human approval confirmed! Branch "${changeName}" successfully merged into production.`));
  return { success: true, outcome: 'AUTO_MERGED', exitCode: 0, message: 'Branch approved and merged.' };
}

/**
 * Deletes a branch to maintain quota (max 2 active branches limit).
 */
export function cleanupFlow(changeName: string, options: BranchOpOptions = {}): FlowResult {
  const resolvedOpts = resolveExecutionOptions(options);
  console.log(pc.cyan(`\n🧹 Cleaning up branch "${changeName}" to free project quota...`));
  const res = deleteBranch(changeName, resolvedOpts);

  if (res.exitCode !== 0) {
    console.error(pc.red(`❌ Failed to delete branch "${changeName}": ${res.stderr || res.stdout}`));
    return { success: false, outcome: 'ERROR', exitCode: 1, message: res.stderr || res.stdout };
  }

  console.log(pc.green(`✓ Deleted branch "${changeName}". Active branch quota restored.`));
  return { success: true, outcome: 'AUTO_MERGED', exitCode: 0, message: 'Branch deleted.' };
}
