/**
 * Interactive prompt helpers for `acr setup local`.
 *
 * Built on Node's built-in `readline` — no external dependencies.
 * All prompters respect `interactive` mode and handle Ctrl+C cleanly.
 */

import * as readline from 'readline';

// ─── Low-Level Prompt Primitives ────────────────────────────────

function createInterface(): readline.Interface {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle Ctrl+C cleanly
  rl.on('SIGINT', () => {
    console.log('\n\n  Setup cancelled.\n');
    process.exit(0);
  });

  return rl;
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * Read input without echoing characters (for secrets).
 * In TTY mode, bypasses readline entirely and reads raw stdin.
 */
function readSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);

    if (!process.stdin.isTTY) {
      // Non-TTY fallback: use readline (input will be visible)
      const rl = createInterface();
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    // TTY: read raw stdin directly — no readline
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    let buf = '';

    const onData = (ch: Buffer) => {
      const char = ch.toString('utf8');

      if (char === '\n' || char === '\r') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(buf.trim());
        return;
      }

      // Ctrl+C
      if (char === '\x03') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        console.log('\n\n  Setup cancelled.\n');
        process.exit(0);
      }

      // Backspace
      if (char === '\x7f' || char === '\b') {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }

      buf += char;
      process.stdout.write('•');
    };

    stdin.on('data', onData);
  });
}

// ─── Public Prompt Helpers ──────────────────────────────────────

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const rl = createInterface();
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(rl, `  ${question} ${hint} `);
  rl.close();

  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

export async function select(question: string, choices: string[]): Promise<number> {
  const rl = createInterface();
  console.log(`\n  ${question}\n`);
  choices.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
  console.log('');

  while (true) {
    const answer = await ask(rl, `  Choose [1-${choices.length}]: `);
    const n = parseInt(answer, 10);
    if (n >= 1 && n <= choices.length) {
      rl.close();
      return n - 1;
    }
    console.log(`  Please enter a number between 1 and ${choices.length}.`);
  }
}

export async function input(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface();
  const hint = defaultValue ? ` (${defaultValue})` : '';
  const answer = await ask(rl, `  ${question}${hint}: `);
  rl.close();
  return answer || defaultValue || '';
}

export async function inputSecret(question: string): Promise<string> {
  return readSecret(`  ${question}: `);
}

// ─── High-Level Setup Prompts ───────────────────────────────────

export type StorageChoice = 'postgres' | 'local' | 'existing_url';

export interface SetupAnswers {
  projectPath: string;
  storage: StorageChoice;
  databaseUrl?: string;
  embeddingApiKey?: string;
  runValidation: boolean;
}

/**
 * Prompt for the project path.
 * Returns the resolved path.
 */
export async function promptProjectPath(defaultPath: string, fallbackPath: string): Promise<string> {
  console.log('');
  const choice = await select('Where should Anchor create your project?', [
    defaultPath,
    fallbackPath !== defaultPath ? fallbackPath : undefined,
    'Choose another location',
  ].filter(Boolean) as string[]);

  if (choice === 0) return defaultPath;
  if (fallbackPath !== defaultPath && choice === 1) return fallbackPath;

  // User wants to type a custom path
  const custom = await input('Enter project path');
  if (!custom) {
    console.log('  No path entered. Using default.');
    return defaultPath;
  }
  return custom;
}

/**
 * Prompt for storage mode.
 */
export async function promptStorageMode(): Promise<{ storage: StorageChoice; databaseUrl?: string }> {
  const choice = await select('Choose storage mode', [
    'Supabase (enter project ID + password)',
    'Postgres (paste a full DATABASE_URL)',
    'Easy local (coming soon — not yet implemented)',
  ]);

  if (choice === 0) {
    // Supabase shortcut flow
    const url = await promptSupabaseCredentials();
    return { storage: 'existing_url', databaseUrl: url };
  }
  if (choice === 1) {
    const url = await input('Paste your DATABASE_URL');
    return { storage: 'existing_url', databaseUrl: url || undefined };
  }
  return { storage: 'local' };
}

// ─── Supabase Shortcut ──────────────────────────────────────────

/**
 * Build a direct Supabase connection URL from project ref and password.
 * Uses the direct format: db.{ref}.supabase.co (no region needed).
 * URL-encodes the password to handle special characters.
 */
function buildSupabaseUrl(projectRef: string, password: string): string {
  const encodedPassword = encodeURIComponent(password);
  return `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`;
}

/**
 * Prompt for Supabase project ref + password and construct the DATABASE_URL.
 */
async function promptSupabaseCredentials(): Promise<string> {
  console.log('');
  console.log('  ⓘ  Find your project ref in: Supabase Dashboard → Project Settings → General');
  console.log('     It\'s the short ID in your project URL (e.g. "abcdefghijklmnopqrst")');
  console.log('');

  const projectRef = await input('Supabase project ref');
  if (!projectRef) {
    console.log('  No project ref entered.');
    return '';
  }

  const password = await inputSecret('Database password (input is hidden)');
  if (!password) {
    console.log('  No password entered.');
    return '';
  }

  const url = buildSupabaseUrl(projectRef, password);
  console.log('');
  console.log('  ✓ Connection URL built');
  return url;
}

/**
 * Prompt for embedding API key (masked input).
 */
export async function promptEmbeddingKey(): Promise<string | undefined> {
  const wantsKey = await confirm('Do you have an OpenAI API key to configure embeddings?', false);
  if (!wantsKey) {
    console.log('  ⓘ  You can add EMBEDDING_API_KEY to .env later before syncing.\n');
    return undefined;
  }
  const key = await inputSecret('Paste your API key (input is hidden)');
  return key || undefined;
}

/**
 * Prompt to run doctor + db-push.
 */
export async function promptRunValidation(): Promise<boolean> {
  return confirm('Run doctor and schema setup now?', true);
}

/**
 * Prompt for existing-directory conflict resolution.
 */
export async function promptExistingDirectory(
  basePath: string,
  siblingPath: string,
): Promise<'reuse' | 'overwrite' | 'sibling'> {
  const choice = await select(
    `"${basePath}" already exists. What would you like to do?`,
    [
      'Reuse the existing folder (skip folder creation)',
      'Overwrite config files in the existing folder',
      `Create a new folder at ${siblingPath}`,
    ],
  );

  if (choice === 0) return 'reuse';
  if (choice === 1) return 'overwrite';
  return 'sibling';
}
