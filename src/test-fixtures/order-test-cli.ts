import { createCLI, createCmd } from '../createCli.ts';

await createCLI(
  { name: 'Order Test CLI', baseCmd: 'order-test-cli' },
  {
    'order': createCmd({
      description: 'Test positional argument order',
      args: {
        first: {
          type: 'positional-string',
          name: 'first',
          description: 'First argument',
        },
        second: {
          type: 'positional-number',
          name: 'second', 
          description: 'Second argument',
        },
        third: {
          type: 'positional-string',
          name: 'third',
          description: 'Third argument',
        },
        verbose: {
          type: 'flag',
          name: 'verbose',
          description: 'Enable verbose output',
        },
      },
      run: async (args) => {
        console.log(`First: ${args.first}`);
        console.log(`Second: ${args.second}`);
        console.log(`Third: ${args.third}`);
        if (args.verbose) console.log('Verbose enabled');
      },
    }),
  },
);