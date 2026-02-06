#!/usr/bin/env node
import { createCLI } from '@ls-stack/cli';
import { advancedReviewChangesCommand } from './commands/advanced-review-changes/advanced-review-changes.ts';
import { commitCommand } from './commands/commit/commit.ts';
import { createPRCommand } from './commands/create-pr/create-pr.ts';
import { reviewCodeChangesCommand } from './commands/review-code-changes/review-code-changes.ts';
import { reviewPRCommand } from './commands/review-pr/review-pr.ts';

await createCLI(
  { name: '✨ ai-cmds', baseCmd: 'ai-cmds' },
  {
    commit: commitCommand,
    'review-code-changes': reviewCodeChangesCommand,
    'review-pr': reviewPRCommand,
    'create-pr': createPRCommand,
    'advanced-review-changes': advancedReviewChangesCommand,
  },
);
