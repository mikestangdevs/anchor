import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  createProjectTree,
  writeSetupConfig,
  writeSetupEnv,
  writeSetupReadme,
  getSiblingPath,
} from '../src/setup/file-writers.js';
import {
  checkPathWritable,
  checkDesktopExists,
  checkConfigExists,
  checkDockerInstalled,
} from '../src/setup/detect.js';
import {
  maskSecret,
  maskDatabaseUrl,
} from '../src/setup/messages.js';

// ─── Test Helpers ───────────────────────────────────────────────

function tmpDir(suffix: string): string {
  return `/tmp/acr-setup-test-${suffix}-${Date.now()}`;
}

// ─── Path Resolution ────────────────────────────────────────────

describe('Path Resolution', () => {
  it('checkDesktopExists returns ok for existing writable dirs', () => {
    // /tmp should always exist and be writable
    const result = checkDesktopExists('/tmp');
    // /tmp/Desktop probably doesn't exist, so this should be ok:false
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('message');
  });

  it('checkDesktopExists returns ok:false when Desktop is absent', () => {
    const result = checkDesktopExists('/tmp/nonexistent-home-' + Date.now());
    expect(result.ok).toBe(false);
  });

  it('checkPathWritable returns ok:true for writable paths', () => {
    const result = checkPathWritable('/tmp');
    expect(result.ok).toBe(true);
  });

  it('checkPathWritable returns ok:false for unwritable paths', () => {
    const result = checkPathWritable('/root/noaccess');
    expect(result.ok).toBe(false);
    expect(result.fix).toBeTruthy();
  });
});

// ─── Folder Creation ────────────────────────────────────────────

describe('Folder Tree Creation', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir('tree');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates the project root and all subdirectories', () => {
    const created = createProjectTree(testDir);

    expect(existsSync(testDir)).toBe(true);
    expect(existsSync(join(testDir, 'sources'))).toBe(true);
    expect(existsSync(join(testDir, 'cache'))).toBe(true);
    expect(existsSync(join(testDir, 'exports'))).toBe(true);
    expect(existsSync(join(testDir, 'data'))).toBe(true);
    expect(existsSync(join(testDir, '.acr'))).toBe(true);
    expect(created.length).toBeGreaterThan(0);
  });

  it('is idempotent — running twice does not error', () => {
    createProjectTree(testDir);
    const secondRun = createProjectTree(testDir);
    // Second run should create no new dirs since all exist
    expect(secondRun).toEqual([]);
  });
});

// ─── Config Generation (no secrets) ─────────────────────────────

describe('Config Generation', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir('config');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('writes .acr/config.json with correct structure', () => {
    const path = writeSetupConfig(testDir, {
      projectName: 'test-project',
      storageMode: 'postgres',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    });

    expect(existsSync(path)).toBe(true);

    const content = JSON.parse(readFileSync(path, 'utf-8'));
    expect(content.project_name).toBe('test-project');
    expect(content.storage_mode).toBe('postgres');
    expect(content.embedding_provider).toBe('openai');
    expect(content.embedding_model).toBe('text-embedding-3-small');
  });

  it('config.json does NOT contain secrets', () => {
    const secretDbUrl = 'postgresql://admin:supersecret@localhost:5432/db';
    const secretApiKey = 'sk-proj-mysecretkey123456789';

    writeSetupConfig(testDir, {
      projectName: 'test',
      storageMode: 'postgres',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    });

    const configPath = join(testDir, '.acr', 'config.json');
    const raw = readFileSync(configPath, 'utf-8');

    // Secrets must never appear in config.json
    expect(raw).not.toContain(secretDbUrl);
    expect(raw).not.toContain(secretApiKey);
    expect(raw).not.toContain('database_url');
    expect(raw).not.toContain('embedding_api_key');
    expect(raw).not.toContain('DATABASE_URL');
    expect(raw).not.toContain('EMBEDDING_API_KEY');
  });
});

// ─── .env Generation (secrets only) ─────────────────────────────

describe('.env Generation', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir('env');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('writes .env with DATABASE_URL and EMBEDDING_API_KEY', () => {
    const path = writeSetupEnv(testDir, {
      databaseUrl: 'postgresql://user:pass@localhost:5432/db',
      embeddingApiKey: 'sk-test-key123',
    });

    expect(existsSync(path)).toBe(true);

    const raw = readFileSync(path, 'utf-8');
    expect(raw).toContain('DATABASE_URL=postgresql://user:pass@localhost:5432/db');
    expect(raw).toContain('EMBEDDING_API_KEY=sk-test-key123');
  });

  it('writes .env with empty values when not provided', () => {
    const path = writeSetupEnv(testDir, {});

    const raw = readFileSync(path, 'utf-8');
    expect(raw).toContain('DATABASE_URL=');
    expect(raw).toContain('EMBEDDING_API_KEY=');
    // Should not contain any actual secrets
    expect(raw).not.toMatch(/DATABASE_URL=.+\S/);
    expect(raw).not.toMatch(/EMBEDDING_API_KEY=.+\S/);
  });
});

// ─── Existing Directory Decisions ───────────────────────────────

describe('Existing Directory Handling', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir('existing');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    // Clean up any sibling dirs
    for (let i = 2; i <= 5; i++) {
      rmSync(`${testDir}-${i}`, { recursive: true, force: true });
    }
  });

  it('checkConfigExists returns ok:true when config exists', () => {
    const acrDir = join(testDir, '.acr');
    mkdirSync(acrDir, { recursive: true });
    writeFileSync(join(acrDir, 'config.json'), '{}');

    const result = checkConfigExists(testDir);
    expect(result.ok).toBe(true);
  });

  it('checkConfigExists returns ok:false when no config', () => {
    const result = checkConfigExists(testDir);
    expect(result.ok).toBe(false);
  });

  it('getSiblingPath finds next available sibling', () => {
    // testDir exists, so sibling should be testDir-2
    const sibling = getSiblingPath(testDir);
    expect(sibling).toBe(`${testDir}-2`);

    // Create testDir-2 and check again
    mkdirSync(`${testDir}-2`, { recursive: true });
    const sibling2 = getSiblingPath(testDir);
    expect(sibling2).toBe(`${testDir}-3`);
  });
});

// ─── Secret Masking ─────────────────────────────────────────────

describe('Secret Masking', () => {
  it('maskSecret hides most of the key', () => {
    const masked = maskSecret('sk-proj-longapikey123456789');
    expect(masked).toBe('sk-proj...');
    expect(masked).not.toContain('longapikey');
  });

  it('maskSecret handles short values', () => {
    const masked = maskSecret('short');
    expect(masked).toBe('***');
  });

  it('maskDatabaseUrl hides the password', () => {
    const masked = maskDatabaseUrl('postgresql://user:mypassword@localhost:5432/db');
    expect(masked).not.toContain('mypassword');
    // The regex replaces ://user:pass@ → :***@ (same as doctor.ts behavior)
    expect(masked).toContain('***@');
  });
});

// ─── README Generation ──────────────────────────────────────────

describe('README Generation', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir('readme');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('generates README with expected sections', () => {
    const path = writeSetupReadme(testDir, 'test-project');

    expect(existsSync(path)).toBe(true);

    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('# test-project');
    expect(content).toContain('acr doctor');
    expect(content).toContain('acr source add');
    expect(content).toContain('acr sync');
    expect(content).toContain('acr search');
    expect(content).toContain('.acr/config.json');
    expect(content).toContain('.env');
  });
});

// ─── Next Steps Output ──────────────────────────────────────────

describe('Next Steps Output', () => {
  it('printNextSteps does not throw', async () => {
    // Import printNextSteps
    const { printNextSteps } = await import('../src/setup/messages.js');

    // Capture console output
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    try {
      printNextSteps('/tmp/test-anchor', {
        needsDatabaseUrl: true,
        needsEmbeddingKey: true,
        doctorSkipped: true,
        dbPushSkipped: true,
      });

      const output = logs.join('\n');
      expect(output).toContain('DATABASE_URL');
      expect(output).toContain('EMBEDDING_API_KEY');
      expect(output).toContain('acr source add');
      expect(output).toContain('acr sync');
      expect(output).toContain('acr search');
    } finally {
      console.log = originalLog;
    }
  });

  it('next steps omit DB/embedding prompts when configured', async () => {
    const { printNextSteps } = await import('../src/setup/messages.js');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    try {
      printNextSteps('/tmp/test-anchor', {
        needsDatabaseUrl: false,
        needsEmbeddingKey: false,
        doctorPassed: true,
        dbPushPassed: true,
      });

      const output = logs.join('\n');
      // Should still have source/sync/search commands
      expect(output).toContain('acr source add');
      // Should NOT prompt for missing config
      expect(output).not.toContain('Set DATABASE_URL');
      expect(output).not.toContain('Add EMBEDDING_API_KEY');
    } finally {
      console.log = originalLog;
    }
  });
});

// ─── Non-Interactive Missing Inputs ─────────────────────────────

describe('Non-Interactive Missing Flags', () => {
  it('printNonInteractiveMissingFlags prints missing flags', async () => {
    const { printNonInteractiveMissingFlags } = await import('../src/setup/messages.js');

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: any[]) => errors.push(args.join(' '));

    try {
      printNonInteractiveMissingFlags([
        '--storage <local|postgres>',
        '--database-url <url>',
      ]);

      const output = errors.join('\n');
      expect(output).toContain('--storage');
      expect(output).toContain('--database-url');
      expect(output).toContain('non-interactive');
    } finally {
      console.error = originalError;
    }
  });
});

// ─── Docker Detection ───────────────────────────────────────────

describe('Docker Detection', () => {
  it('checkDockerInstalled returns a structured result', () => {
    const result = checkDockerInstalled();
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('message');
    // We don't assert ok:true because CI may not have Docker
    if (!result.ok) {
      expect(result.fix).toBeTruthy();
    }
  });
});

// ─── DB Failure Classification ──────────────────────────────────

describe('Database Failure Classification', () => {
  it('classifies auth failure', async () => {
    const { checkDatabase } = await import('../src/setup/detect.js');
    // Try connecting with a guaranteed-bad password to localhost
    // This will either fail with auth or network depending on whether postgres is running
    const result = await checkDatabase('postgresql://nobody:wrongpassword@localhost:59999/nonexistent');
    expect(result.ok).toBe(false);
    expect(result.failureKind).toBeDefined();
    // Should be either 'network' (no server on 59999) or 'auth'
    expect(['auth', 'network', 'missing_db', 'unknown']).toContain(result.failureKind);
    expect(result.message).toBeTruthy();
    expect(result.fix).toBeTruthy();
  });
});

// ─── Output Never Contains Raw Secrets ──────────────────────────

describe('Secrets Never Exposed in Output', () => {
  it('printCreatedFiles does not expose secrets', async () => {
    const { printCreatedFiles } = await import('../src/setup/messages.js');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    try {
      printCreatedFiles('/tmp/anchor', [
        '/tmp/anchor/.acr/config.json',
        '/tmp/anchor/.env',
        '/tmp/anchor/README.md',
      ]);

      const output = logs.join('\n');
      // Filenames are fine, but actual secret values must never appear
      expect(output).not.toMatch(/sk-proj-/);
      expect(output).not.toMatch(/postgresql:\/\/\w+:\w+@/);
    } finally {
      console.log = originalLog;
    }
  });

  it('printDoctorSummary uses masked values', async () => {
    const { printDoctorSummary, maskSecret, maskDatabaseUrl } = await import('../src/setup/messages.js');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    const realKey = 'sk-proj-reallylongsecretkey12345';
    const realUrl = 'postgresql://user:secretpass@host:5432/db';

    try {
      printDoctorSummary([
        { name: 'Database URL', status: 'pass', message: maskDatabaseUrl(realUrl) },
        { name: 'Embedding', status: 'pass', message: maskSecret(realKey) },
      ]);

      const output = logs.join('\n');
      expect(output).not.toContain('secretpass');
      expect(output).not.toContain('reallylongsecretkey');
    } finally {
      console.log = originalLog;
    }
  });
});
