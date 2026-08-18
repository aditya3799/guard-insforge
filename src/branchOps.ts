import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface BranchOpOptions {
  mock?: boolean;
  verbose?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  isConflict?: boolean;
}

// In-memory mock store for mock mode
const mockBranches = new Set<string>();

/**
 * Checks if the local environment is authenticated with InsForge CLI.
 */
export function isInsForgeAuthenticated(): boolean {
  try {
    const stdout = execSync('npx -y @insforge/cli whoami', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000
    });
    // If not logged in, whoami prints "You need to log in to continue." or errors
    return !/need to log in|error|not logged in/i.test(stdout) && stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Executes an InsForge CLI command as a subprocess.
 */
function runInsForgeCmd(args: string[], options: BranchOpOptions = {}): ExecResult {
  const cliCmd = `npx -y @insforge/cli -y ${args.join(' ')}`;

  if (options.verbose) {
    console.log(`[EXEC] ${cliCmd}`);
  }

  try {
    const stdout = execSync(cliCmd, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    const stdout = err.stdout?.toString() || '';
    const stderr = err.stderr?.toString() || err.message || '';
    const combinedOutput = `${stdout}\n${stderr}`;

    const isConflict = /conflict|merge failed|diverged|already exists/i.test(combinedOutput);

    return {
      stdout,
      stderr,
      exitCode: err.status || 1,
      isConflict
    };
  }
}

/**
 * Creates an isolated database branch.
 */
export function createBranch(name: string, sqlInputPath?: string, options: BranchOpOptions = {}): ExecResult {
  if (options.mock || process.env.GUARD_MOCK) {
    if (mockBranches.has(name)) {
      return {
        stdout: `Branch "${name}" already exists.`,
        stderr: '',
        exitCode: 1,
        isConflict: true
      };
    }
    mockBranches.add(name);
    return {
      stdout: `✓ Created branch "${name}" from parent project snapshot.`,
      stderr: '',
      exitCode: 0
    };
  }

  return runInsForgeCmd(['branch', 'create', name], options);
}

/**
 * Applies SQL schema changes to an isolated branch.
 */
export function applySqlToBranch(name: string, sqlFilePath: string, options: BranchOpOptions = {}): ExecResult {
  if (!fs.existsSync(sqlFilePath)) {
    throw new Error(`SQL file not found: ${sqlFilePath}`);
  }

  if (options.mock || process.env.GUARD_MOCK) {
    return {
      stdout: `✓ Applied schema changes from ${path.basename(sqlFilePath)} to branch "${name}".`,
      stderr: '',
      exitCode: 0
    };
  }

  // Switch to branch or execute sql import against branch context
  const switchRes = runInsForgeCmd(['branch', 'switch', name], options);
  if (switchRes.exitCode !== 0) {
    return switchRes;
  }

  const importRes = runInsForgeCmd(['db', 'import', sqlFilePath], options);

  // Switch back to parent
  runInsForgeCmd(['branch', 'switch', '--parent'], options);

  return importRes;
}

/**
 * Runs a dry-run merge and saves rendered SQL diff.
 */
export function mergeDryRun(name: string, saveSqlPath: string, sqlInputPath?: string, options: BranchOpOptions = {}): ExecResult {
  if (options.mock || process.env.GUARD_MOCK) {
    // Check if simulate conflict
    if (sqlInputPath && sqlInputPath.includes('conflict')) {
      return {
        stdout: `Error: Cannot merge branch "${name}" automatically. Merge conflict detected on table "users".`,
        stderr: 'SCHEMA_CONFLICT: Column type mismatch on table users column id.',
        exitCode: 1,
        isConflict: true
      };
    }

    // Copy original SQL or generate diff for dry run preview
    let sqlContent = '';
    if (sqlInputPath && fs.existsSync(sqlInputPath)) {
      sqlContent = fs.readFileSync(sqlInputPath, 'utf-8');
    } else {
      sqlContent = '-- Rendered InsForge DB Dry-Run Diff\nCREATE TABLE mock_table (id serial primary key);';
    }

    const dir = path.dirname(saveSqlPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(saveSqlPath, sqlContent, 'utf-8');

    return {
      stdout: `✓ Computed diff for branch "${name}". Saved SQL preview to ${saveSqlPath}`,
      stderr: '',
      exitCode: 0
    };
  }

  return runInsForgeCmd(['branch', 'merge', name, '--dry-run', '--save-sql', saveSqlPath], options);
}

/**
 * Performs a real merge of a branch into parent production database.
 */
export function mergeReal(name: string, options: BranchOpOptions = {}): ExecResult {
  if (options.mock || process.env.GUARD_MOCK) {
    mockBranches.delete(name);
    return {
      stdout: `✓ Successfully merged branch "${name}" into parent production.`,
      stderr: '',
      exitCode: 0
    };
  }

  return runInsForgeCmd(['branch', 'merge', name], options);
}

/**
 * Resets a branch's database back to T0 parent snapshot.
 */
export function resetBranch(name: string, options: BranchOpOptions = {}): ExecResult {
  if (options.mock || process.env.GUARD_MOCK) {
    return {
      stdout: `✓ Reset branch "${name}" back to T0 snapshot.`,
      stderr: '',
      exitCode: 0
    };
  }

  return runInsForgeCmd(['branch', 'reset', name], options);
}

/**
 * Deletes a branch (cleans up quota).
 */
export function deleteBranch(name: string, options: BranchOpOptions = {}): ExecResult {
  if (options.mock || process.env.GUARD_MOCK) {
    mockBranches.delete(name);
    return {
      stdout: `✓ Deleted branch "${name}". Quota freed.`,
      stderr: '',
      exitCode: 0
    };
  }

  return runInsForgeCmd(['branch', 'delete', name], options);
}
