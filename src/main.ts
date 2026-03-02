#!/usr/bin/env node
import { createCLI } from '@ls-stack/cli';
import { advancedReviewChangesCommand } from './commands/advanced-review-changes/advanced-review-changes.ts';
import { commitCommand } from './commands/commit/commit.ts';
import { createPRCommand } from './commands/create-pr/create-pr.ts';
import { reviewCodeChangesCommand } from './commands/review-code-changes/review-code-changes.ts';
import { reviewPRCommand } from './commands/review-pr/review-pr.ts';
import { setGlobalEnvsCommand } from './commands/set-global-envs/set-global-envs.ts';
import { syncPRDescriptionCommand } from './commands/sync-pr-description/sync-pr-description.ts';

await createCLI(
  { name: '✨ ai-cmds', baseCmd: 'ai-cmds' },
  {
    commit: commitCommand,
    'review-code-changes': reviewCodeChangesCommand,
    'review-pr': reviewPRCommand,
    'create-pr': createPRCommand,
    'sync-pr-description': syncPRDescriptionCommand,
    'advanced-review-changes': advancedReviewChangesCommand,
    'set-global-envs': setGlobalEnvsCommand,
  },
);
