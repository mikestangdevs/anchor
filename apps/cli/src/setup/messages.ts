/**
 * User-facing output helpers for `acr setup local`.
 *
 * Handles branded output, friendly error rendering, and next-steps messaging.
 * IMPORTANT: Never print raw secrets (API keys, passwords) in output.
 */

// ─── Color Helpers ──────────────────────────────────────────────

function supportsColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === 'dumb') return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  if (typeof process.stdout.isTTY === 'boolean') return process.stdout.isTTY;
  return false;
}

const useColor = supportsColor();
const green = (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s);
const red = (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s);
const purple = (s: string) => (useColor ? `\x1b[35m${s}\x1b[0m` : s);

// ─── Setup Header ───────────────────────────────────────────────

export function printSetupHeader(): void {
  console.log('');
  console.log(purple('  ⚓ Anchor — Setup'));
  console.log(dim('  Bootstrap a new ACR workspace'));
  console.log('');
}

// ─── Created Files ──────────────────────────────────────────────

export function printCreatedFiles(rootPath: string, files: string[]): void {
  console.log('');
  console.log(bold('  Created:'));
  for (const file of files) {
    const relative = file.startsWith(rootPath)
      ? file.slice(rootPath.length + 1) || file
      : file;
    console.log(`  ${green('✓')} ${relative}`);
  }
  console.log('');
}

// ─── Next Steps ─────────────────────────────────────────────────

export function printNextSteps(rootPath: string, options?: {
  needsDatabaseUrl?: boolean;
  needsEmbeddingKey?: boolean;
  doctorPassed?: boolean;
  doctorSkipped?: boolean;
  dbPushPassed?: boolean;
  dbPushSkipped?: boolean;
}): void {
  const opts = options ?? {};

  console.log(bold('  ── Next Steps ──'));
  console.log('');

  let step = 1;

  console.log(`  ${step}. ${dim('cd')} ${rootPath}`);
  step++;

  if (opts.needsDatabaseUrl) {
    console.log('');
    console.log(`  ${step}. ${yellow('Set DATABASE_URL in .env')}`);
    console.log('     Supabase: Dashboard → Project Settings → Database → Connection string → URI');
    console.log('     Local:    postgresql://user:pass@localhost:5432/dbname');
    step++;
  }

  if (opts.needsEmbeddingKey) {
    console.log('');
    console.log(`  ${step}. ${yellow('Add EMBEDDING_API_KEY to .env')}`);
    console.log('     Get a key: https://platform.openai.com/api-keys');
    step++;
  }

  if (!opts.dbPushPassed && !opts.dbPushSkipped && !opts.needsDatabaseUrl) {
    console.log('');
    console.log(`  ${step}. acr db-push          ${dim('# create database tables')}`);
    step++;
  }

  if (!opts.doctorPassed && !opts.doctorSkipped) {
    console.log('');
    console.log(`  ${step}. acr doctor           ${dim('# verify setup')}`);
    step++;
  }

  console.log('');
  console.log(`  ${step}. ${dim('Add your first source:')}`);
  console.log(`     acr source add --name "MCP Docs" --type docs_site --url https://modelcontextprotocol.io/docs`);
  step++;

  console.log('');
  console.log(`  ${step}. acr sync --all        ${dim('# fetch, chunk, and embed')}`);
  step++;
  console.log(`  ${step}. acr search "What is MCP?"  ${dim('# semantic search')}`);
  step++;

  console.log('');
  console.log(dim('  To keep sources fresh automatically:'));
  console.log(`    acr worker         ${dim('# continuous background sync (poll mode)')}`);
  console.log(`    acr worker --once  ${dim('# sync anything overdue right now')}`);

  console.log('');
}

// ─── Friendly Errors ────────────────────────────────────────────

import type { DetectResult, DbCheckResult } from './detect.js';

export function printDetectResult(label: string, result: DetectResult): void {
  if (result.ok) {
    console.log(`  ${green('✓')} ${label.padEnd(22)} ${result.message}`);
  } else {
    console.log(`  ${red('✗')} ${label.padEnd(22)} ${result.message}`);
    if (result.fix) {
      console.log(`${''.padEnd(27)}${dim('→')} ${result.fix}`);
    }
  }
}

export function printDbCheckResult(result: DbCheckResult): void {
  if (result.ok) {
    console.log(`  ${green('✓')} Database              ${result.message}`);
  } else {
    console.log(`  ${red('✗')} Database              ${result.message}`);
    if (result.fix) {
      console.log(`${''.padEnd(27)}${dim('→')} ${result.fix}`);
    }
    if (result.detail) {
      console.log(`${''.padEnd(27)}${dim('  ')} ${dim(result.detail)}`);
    }
  }
}

// ─── Storage Mode Notice ────────────────────────────────────────

export function printLocalStorageNotice(): void {
  console.log('');
  console.log(yellow('  ⓘ  Easy local mode is planned but not yet implemented.'));
  console.log('     Choose Postgres or provide an existing DATABASE_URL.');
  console.log('     Local mode will be available in a future release.');
  console.log('');
}

// ─── Doctor Summary (from check results) ────────────────────────

export function printDoctorSummary(results: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; message: string; fix?: string }>): void {
  console.log('');
  console.log(bold('  Health Check'));
  console.log(dim('  ─────────'));
  console.log('');

  for (const r of results) {
    const icon = r.status === 'pass' ? green('✓')
      : r.status === 'warn' ? yellow('⚠')
      : red('✗');
    console.log(`  ${icon} ${r.name.padEnd(22)} ${r.message}`);
    if (r.fix && r.status !== 'pass') {
      console.log(`${''.padEnd(27)}${dim('→')} ${r.fix}`);
    }
  }

  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const overall = failCount > 0 ? red('✗ Unhealthy') : warnCount > 0 ? yellow('⚠ Degraded') : green('✓ Healthy');
  console.log('');
  console.log(`  ${overall} — ${passCount} passed, ${warnCount} warnings, ${failCount} failed`);
  console.log('');
}

// ─── Masking ────────────────────────────────────────────────────

/** Mask a secret for safe display — shows first 7 chars only. */
export function maskSecret(value: string): string {
  if (value.length <= 7) return '***';
  return value.slice(0, 7) + '...';
}

/** Mask a DATABASE_URL — hides the password portion. */
export function maskDatabaseUrl(url: string): string {
  return url.replace(/:[^@]+@/, ':***@');
}

// ─── Non-Interactive Errors ─────────────────────────────────────

export function printNonInteractiveMissingFlags(missing: string[]): void {
  console.error('');
  console.error(red('  ✗ Cannot run setup in non-interactive mode — missing required inputs:'));
  console.error('');
  for (const flag of missing) {
    console.error(`    • ${flag}`);
  }
  console.error('');
  console.error('  Either provide these flags or run without --non-interactive.');
  console.error('');
}

// ─── Success Banner ─────────────────────────────────────────────

export interface SetupStatus {
  dbConfigured: boolean;   // DATABASE_URL was provided
  dbValidated: boolean;    // DB connection + pgvector check passed
  embeddingConfigured: boolean;
  doctorPassed: boolean;
  dbPushPassed: boolean;
}

export function printSetupComplete(rootPath: string, status: SetupStatus): void {
  console.log('');

  // Always acknowledge the workspace was created
  console.log(green(bold('  ✓ Workspace created')));
  console.log(dim(`    ${rootPath}`));

  // Show warnings for outstanding items
  const warnings: string[] = [];
  if (!status.dbConfigured) {
    warnings.push('Database not configured — add DATABASE_URL to .env');
  } else if (!status.dbValidated) {
    warnings.push('Database still needs attention — check your DATABASE_URL');
  }
  if (!status.embeddingConfigured) {
    warnings.push('Embeddings not configured — add EMBEDDING_API_KEY to .env before syncing');
  }

  if (warnings.length > 0) {
    console.log('');
    for (const w of warnings) {
      console.log(`  ${yellow('⚠')} ${w}`);
    }
  } else {
    // Everything looks good
    console.log(green('  ✓ Fully configured and ready to use'));
  }

  console.log('');
}
