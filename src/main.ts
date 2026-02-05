import { createCLI } from '@ls-stack/cli';
import { reviewCodeCommand } from './commands/review-code/index.ts';

await createCLI(
  { name: '✨ ai-cmds', baseCmd: 'ai-cmds' },
  {
    'review-code-changes': reviewCodeCommand,
  },
);
