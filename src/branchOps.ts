import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { stripSqlComments } from './classifier';

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
    const res = spawnSync('npx -y @insforge/cli whoami', {
      shell: true,
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 15000
    });
    const stdout = res.stdout || '';
    return res.status === 0 && !/need to log in|error|not logged in/i.test(stdout) && stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Executes an InsForge CLI command as a subprocess without shell interpolation.
 */
function runInsForgeCmd(args: string[], options: BranchOpOptions = {}): ExecResult {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'npx.cmd' : 'npx';
  const fullArgs = ['-y', '@insforge/cli', '-y', ...args];

  if (options.verbose) {
    console.log(`[EXEC] ${command} ${fullArgs.join(' ')}`);
  }

  try {
    const res = spawnSync(command, fullArgs, {
      shell: true, // Required on Windows so output streams of .cmd files aren't dropped
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 60000
    });

    const stdout = res.stdout || '';
    let stderr = res.stderr || '';
    const combinedOutput = `${stdout}\n${stderr}`;

    const isConflict = /conflict|merge failed|diverged|already exists/i.test(combinedOutput);

    if (res.status !== 0) {
      let cleanErr = (stderr || stdout || 'Command returned non-zero exit code').trim();
      cleanErr = cleanErr
        .replace(/Assertion failed:.*$/gm, '')
        .replace(/file src\\win\\async\.c, line \d+/gm, '')
        .trim();

      return {
        stdout,
        stderr: cleanErr || stdout.trim() || 'InsForge CLI request rejected',
        exitCode: res.status || 1,
        isConflict
      };
    }

    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: '',
      stderr: err.message || 'Subprocess execution failed',
      exitCode: 1,
      isConflict: false
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

  // 1. Check existing branches and auto-prune any 'merged' branches to keep quota free
  try {
    const listRes = runInsForgeCmd(['branch', 'list'], options);
    if (listRes.exitCode === 0 && listRes.stdout) {
      const lines = listRes.stdout.split('\n');
      for (const line of lines) {
        if (line.includes('merged')) {
          // Adjust regex to match table pipes more safely
          const match = line.match(/│[^│]*│\s*([^\s│]+)\s*│\s*merged\s*│/);
          if (match && match[1]) {
            const mergedBranchName = match[1].trim();
            if (options.verbose) {
              console.log(`[QUOTA PRUNE] Deleting merged branch "${mergedBranchName}" to free quota...`);
            }
            runInsForgeCmd(['branch', 'delete', mergedBranchName], options);
          }
        }
      }

      // Check if target branch already exists and is ready
      const isTargetReady = lines.some(l => l.includes(name) && l.includes('ready'));
      if (isTargetReady) {
        return {
          stdout: `✓ Branch "${name}" already exists and is ready.`,
          stderr: '',
          exitCode: 0
        };
      }
    }
  } catch {
    // Ignore list/prune errors and attempt branch creation directly
  }

  const createRes = runInsForgeCmd(['branch', 'create', name], options);

  // If branch was created or is provisioning / already exists, poll until 'ready'
  const isCreatingOrExists =
    createRes.exitCode === 0 ||
    /creating|provisioning|already exists/i.test(`${createRes.stdout}\n${createRes.stderr}`);

  if (isCreatingOrExists) {
    const startTime = Date.now();
    while (Date.now() - startTime < 45000) {
      const listRes = runInsForgeCmd(['branch', 'list'], options);
      if (listRes.stdout && listRes.stdout.includes(name) && listRes.stdout.includes('ready')) {
        return {
          stdout: `✓ Created branch "${name}" from parent project snapshot. State: ready.`,
          stderr: '',
          exitCode: 0
        };
      }
      const sleepStart = Date.now();
      while (Date.now() - sleepStart < 3000) {}
    }
  }

  return createRes;
}

/**
 * Applies SQL schema changes to an isolated branch via InsForge CLI db query --unrestricted.
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

  // Switch to branch context
  const switchRes = runInsForgeCmd(['branch', 'switch', name], options);
  if (switchRes.exitCode !== 0) {
    return switchRes;
  }

  // Read and clean the SQL, then split into individual statements
  const rawSql = fs.readFileSync(sqlFilePath, 'utf-8');
  const cleanSql = stripSqlComments(rawSql).trim();
  const statements = cleanSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    
    // Manually escape double quotes and wrap the entire statement in double quotes.
    // Node's spawnSync with shell: true on Windows concatenates arguments with spaces,
    // so we must provide our own cmd.exe-compatible quoting to prevent 'too many arguments' errors.
    const escapedStmt = `"${stmt.replace(/"/g, '\\"')}"`;
    
    const qResRaw = spawnSync('npx.cmd', ['-y', '@insforge/cli', '-y', 'db', 'query', '--unrestricted', escapedStmt], {
      encoding: 'utf-8',
      windowsHide: true,
      shell: true,
      timeout: 60000
    });

    if (qResRaw.status !== 0) {
      runInsForgeCmd(['branch', 'switch', '--parent'], options);
      return {
        stdout: '',
        stderr: `Statement ${i + 1}/${statements.length} failed: ${qResRaw.stderr || qResRaw.stdout || 'Unknown error'}`,
        exitCode: 1
      };
    }
  }

  // Switch back to parent context
  runInsForgeCmd(['branch', 'switch', '--parent'], options);

  return {
    stdout: `✓ Executed ${statements.length} SQL statement(s) on branch "${name}".`,
    stderr: '',
    exitCode: 0
  };
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
