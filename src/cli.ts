#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { applyFlow, approveFlow, cleanupFlow } from './flow';
import { classifySqlFile } from './classifier';

const program = new Command();

program
  .name('guard')
  .description('Agent Change Guard for InsForge — Deterministic safety gate for AI agent database migrations')
  .version('1.0.0');

program
  .command('apply')
  .argument('<change-name>', 'Unique identifier for the proposed database change/branch')
  .requiredOption('-s, --sql <path>', 'Path to the SQL migration file containing proposed schema changes')
  .option('-m, --mock', 'Run in mock mode (simulates InsForge CLI subprocess calls for offline demos/testing)')
  .option('-c, --cleanup', 'Automatically delete the isolated branch after successful auto-merge')
  .action((changeName, options) => {
    try {
      const result = applyFlow(changeName, options.sql, {
        mock: options.mock,
        cleanup: options.cleanup
      });
      process.exit(result.exitCode);
    } catch (err: any) {
      console.error(pc.red(`Fatal Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('approve')
  .argument('<change-name>', 'Name of the held branch to approve and merge')
  .option('-m, --mock', 'Run in mock mode')
  .action((changeName, options) => {
    try {
      const result = approveFlow(changeName, { mock: options.mock });
      process.exit(result.exitCode);
    } catch (err: any) {
      console.error(pc.red(`Fatal Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('cleanup')
  .argument('<change-name>', 'Name of the branch to delete from InsForge')
  .option('-m, --mock', 'Run in mock mode')
  .action((changeName, options) => {
    try {
      const result = cleanupFlow(changeName, { mock: options.mock });
      process.exit(result.exitCode);
    } catch (err: any) {
      console.error(pc.red(`Fatal Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('classify')
  .description('Standalone classification check for a local SQL file')
  .requiredOption('-s, --sql <path>', 'Path to SQL file')
  .action((options) => {
    try {
      console.log(pc.cyan(`\n🔍 Classifying SQL File: ${options.sql}\n`));
      const res = classifySqlFile(options.sql);
      console.log(`Verdict: ${res.isSafe ? pc.green(res.verdict) : pc.red(res.verdict)}`);
      console.log(`Total Statements: ${res.summary.totalStatements}`);
      console.log(`Safe: ${pc.green(res.summary.safeCount)} | Destructive: ${pc.red(res.summary.destructiveCount)} | Review: ${pc.yellow(res.summary.reviewCount)}\n`);

      res.statements.forEach(stmt => {
        const symbol = stmt.isSafe ? pc.green('✓') : pc.red('🚨');
        console.log(` ${symbol} [${stmt.matchedRule}] Stmt #${stmt.index}: ${stmt.normalizedSql.substring(0, 60)}`);
      });
      process.exit(res.isSafe ? 0 : 1);
    } catch (err: any) {
      console.error(pc.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
