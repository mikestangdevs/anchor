/**
 * Environment detection utilities for `acr setup local`.
 *
 * Every check returns a structured result — never throws.
 */

import { existsSync, accessSync, constants } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// ─── Result Type ────────────────────────────────────────────────

export interface DetectResult {
  ok: boolean;
  message: string;
  fix?: string;
  detail?: string;  // internal detail (not printed to user)
}

// ─── Path Checks ────────────────────────────────────────────────

export function checkPathWritable(targetPath: string): DetectResult {
  try {
    // Check the parent dir if target doesn't exist yet
    const pathToCheck = existsSync(targetPath)
      ? targetPath
      : join(targetPath, '..');

    accessSync(pathToCheck, constants.W_OK);
    return { ok: true, message: `Path is writable: ${targetPath}` };
  } catch {
    return {
      ok: false,
      message: `Cannot write to ${targetPath}`,
      fix: 'Choose a different path with --path, or check folder permissions.',
    };
  }
}

export function checkDesktopExists(homedir: string): DetectResult {
  const desktop = join(homedir, 'Desktop');
  if (existsSync(desktop)) {
    try {
      accessSync(desktop, constants.W_OK);
      return { ok: true, message: desktop };
    } catch {
      return { ok: false, message: `~/Desktop exists but is not writable` };
    }
  }
  return { ok: false, message: `~/Desktop does not exist` };
}

export function checkConfigExists(projectPath: string): DetectResult {
  const configPath = join(projectPath, '.acr', 'config.json');
  if (existsSync(configPath)) {
    return {
      ok: true,
      message: `Config already exists at ${configPath}`,
    };
  }
  return { ok: false, message: 'No existing config found' };
}

// ─── Docker Checks ──────────────────────────────────────────────

export function checkDockerInstalled(): DetectResult {
  try {
    const version = execSync('docker --version', {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
    return { ok: true, message: version };
  } catch {
    return {
      ok: false,
      message: 'Docker is not installed',
      fix: 'Install Docker Desktop from https://docker.com/products/docker-desktop',
    };
  }
}

export function checkDockerRunning(): DetectResult {
  try {
    execSync('docker info', {
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, message: 'Docker daemon is running' };
  } catch {
    return {
      ok: false,
      message: 'Docker is installed but not running',
      fix: 'Start Docker Desktop and rerun setup, or choose a different storage option.',
    };
  }
}

// ─── Database Check (unified) ───────────────────────────────────

export type DbFailureKind = 'auth' | 'network' | 'missing_db' | 'missing_pgvector' | 'unknown';

export interface DbCheckResult extends DetectResult {
  failureKind?: DbFailureKind;
  pgvectorInstalled?: boolean;
}

/**
 * Unified database validation.
 * Connects, runs `SELECT 1`, checks pgvector — classifies failures.
 */
export async function checkDatabase(databaseUrl: string): Promise<DbCheckResult> {
  let sql: any;
  try {
    const postgres = (await import('postgres')).default;
    const isRemote =
      databaseUrl.includes('supabase') ||
      databaseUrl.includes('neon') ||
      !databaseUrl.includes('localhost');

    sql = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      onnotice: () => {},
      ...(isRemote ? { ssl: 'require' } : {}),
      ...(databaseUrl.includes('pooler.supabase') ? { prepare: false } : {}),
    });

    // Basic connectivity
    await sql`SELECT 1`;

    // Check pgvector
    let pgvectorInstalled = false;
    try {
      const extRows = await sql`SELECT 1 FROM pg_extension WHERE extname = 'vector'`;
      pgvectorInstalled = extRows.length > 0;
    } catch {
      // Can't check — assume not installed
    }

    await sql.end();

    if (!pgvectorInstalled) {
      return {
        ok: false,
        message: 'Connected to database, but pgvector extension is not installed.',
        fix: 'In Supabase Dashboard → Database → Extensions → search "vector" → enable it.',
        failureKind: 'missing_pgvector',
        pgvectorInstalled: false,
      };
    }

    return {
      ok: true,
      message: 'Database connected, pgvector installed.',
      pgvectorInstalled: true,
    };
  } catch (err: any) {
    // Make sure we clean up
    try { await sql?.end(); } catch { /* ignore */ }

    const msg = err?.message ?? String(err);

    // Classify the failure
    if (msg.includes('password authentication failed') || msg.includes('no pg_hba.conf entry')) {
      return {
        ok: false,
        message: 'ACR found a database server, but the provided credentials were rejected.',
        fix: 'Double-check the username and password in your DATABASE_URL.',
        failureKind: 'auth',
        detail: msg,
      };
    }

    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('could not connect') ||
      msg.includes('getaddrinfo') ||
      msg.includes('connect ETIMEDOUT') ||
      msg.includes('Connection terminated unexpectedly')
    ) {
      return {
        ok: false,
        message: 'Could not reach the database server.',
        fix: 'Verify the host and port in your DATABASE_URL. If using local Postgres, make sure it is running.',
        failureKind: 'network',
        detail: msg,
      };
    }

    if (msg.includes('database') && msg.includes('does not exist')) {
      return {
        ok: false,
        message: 'The database specified in your URL does not exist.',
        fix: 'Create it with: createdb <dbname>  — or use a different DATABASE_URL.',
        failureKind: 'missing_db',
        detail: msg,
      };
    }

    return {
      ok: false,
      message: 'Database connection failed.',
      fix: 'Check your DATABASE_URL and try again.',
      failureKind: 'unknown',
      detail: msg,
    };
  }
}
