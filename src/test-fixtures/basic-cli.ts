import { createCLI, createCmd } from '../createCli.ts';

await createCLI(
  { name: 'Basic CLI', baseCmd: 'basic-cli' },
  {
    'hello': createCmd({
      description: 'Say hello to someone',
      short: 'hi',
      run: async () => {
        console.log('Hello World!');
      },
    }),
  },
);