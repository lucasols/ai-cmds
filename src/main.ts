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
          name: 'pr',
          description: 'The pull request to review',
        },
      },
      examples: [{ args: ['123'], description: 'Review pull request 123' }],
      run: async () => {
        console.log('Reviewing pull request');
      },
    }),
  },
);
