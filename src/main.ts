#!/usr/bin/env node
import { createCLI } from '@ls-stack/cli';
import { createPRCommand } from './commands/create-pr/index.ts';
import { reviewCodeChangesCommand } from './commands/review-code-changes/index.ts';
import { reviewPRCommand } from './commands/review-pr/index.ts';

await createCLI(
  { name: '✨ ai-cmds', baseCmd: 'ai-cmds' },
  {
    'review-code-changes': reviewCodeChangesCommand,
    'review-pr': reviewPRCommand,
    'create-pr': createPRCommand,
  },
);
