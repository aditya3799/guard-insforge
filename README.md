# 🛡️ Agent Change Guard for InsForge (`guard-insforge`)

> **Automated, deterministic safety gate for AI coding agents applying database migrations on InsForge.**

[![npm version](https://img.shields.io/npm/v/guard-insforge.svg)](https://www.npmjs.com/package/guard-insforge)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![InsForge CLI](https://img.shields.io/badge/Built%20On-InsForge%20CLI-6366f1.svg)](https://insforge.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🚀 Instant Quickstart (Run via `npx`)

Try it out in **30 seconds** in any terminal — no InsForge login or setup required!

```bash
# 1. Test a safe migration (auto-merges)
npx guard-insforge apply safe-demo --sql https://raw.githubusercontent.com/aditya3799/guard-insforge/main/examples/safe-change.sql

# 2. Test a destructive migration (catches DROP COLUMN, TRUNCATE, etc.)
npx guard-insforge apply dest-demo --sql https://raw.githubusercontent.com/aditya3799/guard-insforge/main/examples/destructive-change.sql
```

> ⚡ **Zero-Friction Auto-Mock Mode:** When no active InsForge login is detected, `guard-insforge` automatically runs in mock simulation mode. Once you log in (`npx @insforge/cli login`), it automatically executes live against your real InsForge project database!

---

## 💡 Pitch & Value Proposition

Autonomous AI coding agents (such as Antigravity, Claude Engineer, Cursor, and Devin) generate database schema changes at high speed. However, executing unreviewed agent-generated SQL directly against production risks catastrophic data loss — such as accidental `DROP COLUMN`, `TRUNCATE TABLE`, or data-type alterations.

InsForge already provides powerful **database branching primitives** (`insforge branch create`, `insforge branch merge --dry-run`). **Agent Change Guard (`guard-insforge`)** is a CLI wrapper built **directly on top of InsForge's existing branch CLI**. 

It intercepts agent-proposed SQL migrations, applies them on an isolated database branch, extracts the exact SQL diff via InsForge's `--dry-run --save-sql` primitive, and passes it through a **fast, deterministic rule-based classifier**:

- **✅ Safe Changes** (e.g., `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`, `CREATE POLICY`) are **automatically merged** to production with zero friction.
- **🛑 Destructive Changes** (e.g., `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `ALTER COLUMN TYPE`, `DROP POLICY`) are **stopped and held on the branch**. The tool generates a clear safety report and requires explicit human approval before touching production.
- **🔍 Ambiguous / Unmatched Syntax** fails closed (flagged for review), ensuring zero false negatives on schema risk.

> [!IMPORTANT]
> **Built ON TOP of InsForge, Not Around It:** `guard-insforge` does not reimplement branching or replace InsForge tools. It leverages InsForge's real CLI primitives (`insforge branch ...`, `insforge db ...`) and adds the missing mechanical gate between AI agent proposal and production deployment.

---

## 🏗️ Architecture & Workflow

```
               [ AI Coding Agent ]
                        │
                        ▼ (npx guard-insforge apply <name> --sql migration.sql)
        ┌───────────────────────────────┐
        │  1. insforge branch create    │
        │  2. insforge db import/query │
        └───────────────┬───────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │  3. insforge branch merge     │
        │     --dry-run --save-sql      │
        └───────────────┬───────────────┘
                        │
                        ▼ (Renders real SQL diff)
        ┌───────────────────────────────┐
        │  4. Deterministic Classifier  │
        └───────────────┬───────────────┘
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
    [ Safe ]                    [ Destructive ]
         │                             │
         ▼                             ▼
┌───────────────────┐       ┌───────────────────────┐
│ 5a. Auto-Merge    │       │ 5b. Hold Branch Open  │
│ insforge branch   │       │     Output Safety Rep │
│ merge <name>      │       │     Exit Code 1       │
└───────────────────┘       └───────────┬───────────┘
                                        │
                                        ▼ (Explicit Human Approval)
                            ┌───────────────────────┐
                            │ guard approve <name>  │
                            └───────────────────────┘
```

---

## ⚖️ Classifier Safety Rules

The classifier evaluates SQL statements deterministically using fast, explainable regex patterns:

| Operation | Safety Category | Action | Rationale |
| :--- | :--- | :--- | :--- |
| `CREATE TABLE` | **SAFE** | Auto-Merge | Additive table creation |
| `ADD COLUMN` | **SAFE** | Auto-Merge | Additive column addition |
| `CREATE INDEX` | **SAFE** | Auto-Merge | Additive index creation |
| `CREATE POLICY` | **SAFE** | Auto-Merge | Additive RLS policy addition |
| `DROP TABLE` | **DESTRUCTIVE** | Hold Branch | Loss of entire table and contents |
| `DROP COLUMN` | **DESTRUCTIVE** | Hold Branch | Loss of column data |
| `TRUNCATE` | **DESTRUCTIVE** | Hold Branch | Mass deletion of rows |
| `ALTER COLUMN TYPE` | **DESTRUCTIVE** | Hold Branch | Type conversion data loss / cast failure |
| `DROP POLICY` | **DESTRUCTIVE** | Hold Branch | Removal of RLS security guardrails |
| *Unmatched Syntax* | **NEEDS_REVIEW** | Hold Branch | **Fail Closed**: Any unknown syntax defaults to human review |

---

## ⚡ Exit Codes

| Scenario | Exit Code | Purpose |
| :--- | :---: | :--- |
| **Safe Auto-Merge** | `0` | Migration clean and merged successfully |
| **Risk Hold** | `1` | Destructive statement caught, branch held for human review |
| **Schema Conflict** | `2` | Branch schema diverged from production parent |

---

## 🛠️ CLI Command Reference

```bash
npx guard-insforge apply <change-name> --sql <path> [--mock] [--cleanup]
  Applies proposed migration to isolated branch, generates dry-run diff,
  classifies risk, and auto-merges or holds.

npx guard-insforge approve <change-name> [--mock]
  Merges a held branch after explicit human review.

npx guard-insforge cleanup <change-name> [--mock]
  Deletes a branch to restore the project's active branch quota.

npx guard-insforge classify --sql <path>
  Runs standalone classifier check on local SQL file without branch side-effects.
```

---

## 📦 Publishing to npm

To publish this package to npm:

```bash
# 1. Login to your npm account
npm login

# 2. Publish package publicly
npm publish
```

After publishing, anyone can run `npx guard-insforge` instantly!

---

## 📄 License

MIT © Aditya Kudale
