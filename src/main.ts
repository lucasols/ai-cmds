#!/usr/bin/env node
import { createCLI } from '@ls-stack/cli';
import { createPRCommand } from './commands/create-pr/create-pr.ts';
import { reviewCodeChangesCommand } from './commands/review-code-changes/review-code-changes.ts';
import { reviewPRCommand } from './commands/review-pr/review-pr.ts';

await createCLI(
  { name: '✨ ai-cmds', baseCmd: 'ai-cmds' },
  {
    'review-code-changes': reviewCodeChangesCommand,
    'review-pr': reviewPRCommand,
    'create-pr': createPRCommand,
  },
);
