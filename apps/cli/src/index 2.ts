#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { dbPushCommand } from './commands/db-push.js';
import { addSourceCommand } from './commands/add-source.js';
import { deleteSourceCommand } from './commands/delete-source.js';
import { listSourcesCommand } from './commands/list-sources.js';
import { sourceInspectCommand } from './commands/source-inspect.js';
import { syncCommand } from './commands/sync.js';
import { searchCommand } from './commands/search.js';
import { getDocumentCommand } from './commands/get-document.js';
import { annotateCommand } from './commands/annotate.js';
import { runMcpCommand } from './commands/run-mcp.js';
import { getCompactHeader } from './branding.js';

const program = new Command();

program
  .name('acr')
  .description('Anchor — agent-first context infrastructure')
  .version('0.1.0-beta.1')
  .addHelpText('before', getCompactHeader());

// ── Setup ──
initCommand.description('Initialize ACR in the current directory');
dbPushCommand.description('Push database schema (safe migration by default)');
doctorCommand.description('Verify configuration, database, and provider setup');

program.addCommand(initCommand);
program.addCommand(dbPushCommand);
program.addCommand(doctorCommand);

// ── Source Management (grouped) ──
const sourceGroup = new Command('source')
  .description('Manage context sources')
  .addHelpText('after', `
Examples:
  acr source add --name "My Docs" --type local_folder --folder-path ./docs
  acr source list
  acr source inspect "My Docs"
  acr source delete "My Docs" --yes`);

// Re-name subcommands for the group
const sourceAdd = addSourceCommand.name('add');
const sourceList = listSourcesCommand.name('list');
const sourceInspect = sourceInspectCommand.name('inspect');
const sourceDelete = deleteSourceCommand.name('delete');

sourceGroup.addCommand(sourceAdd);
sourceGroup.addCommand(sourceList);
sourceGroup.addCommand(sourceInspect);
sourceGroup.addCommand(sourceDelete);
program.addCommand(sourceGroup);

// ── Flat aliases for backwards compatibility ──
// These mirror the grouped commands so `acr add-source` still works
const addSourceAlias = new Command('add-source')
  .description('Register a new source (alias for: source add)')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (_opts, cmd) => {
    // Re-parse with the real command
    await sourceAdd.parseAsync(cmd.args, { from: 'user' });
  });

const listSourcesAlias = new Command('list-sources')
  .description('List all sources (alias for: source list)')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (_opts, cmd) => {
    await sourceList.parseAsync(cmd.args, { from: 'user' });
  });

const sourceInspectAlias = new Command('source-inspect')
  .description('Inspect a source (alias for: source inspect)')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (_opts, cmd) => {
    await sourceInspect.parseAsync(cmd.args, { from: 'user' });
  });

const deleteSourceAlias = new Command('delete-source')
  .description('Delete a source (alias for: source delete)')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (_opts, cmd) => {
    await sourceDelete.parseAsync(cmd.args, { from: 'user' });
  });

addSourceAlias.helpOption(false);
listSourcesAlias.helpOption(false);
sourceInspectAlias.helpOption(false);
deleteSourceAlias.helpOption(false);

program.addCommand(addSourceAlias, { hidden: true });
program.addCommand(listSourcesAlias, { hidden: true });
program.addCommand(sourceInspectAlias, { hidden: true });
program.addCommand(deleteSourceAlias, { hidden: true });

// ── Sync & Retrieval ──
syncCommand.description('Sync one or all sources (fetch → chunk → embed)');
searchCommand.description('Semantic search across all synced context');

program.addCommand(syncCommand);
program.addCommand(searchCommand);
program.addCommand(getDocumentCommand);
program.addCommand(annotateCommand);

// ── Server ──
program.addCommand(runMcpCommand);

program.parse();
