import { createCLI, createCmd } from './createCli.ts';

await createCLI(
  { name: '✨ ai-cli', baseCmd: 'ai-cli' },
  {
    'review-pr': createCmd({
      description: 'Review a pull request with AI',
      short: 'rpr',
      args: {
        pr: {
          type: 'positional-number',
          pos: 0,
          required: false,
          name: 'pr',
          description: 'The pull request to review',
        },
      },
      run: async () => {
        console.log('Reviewing pull request');
      },
    }),
  },
);
