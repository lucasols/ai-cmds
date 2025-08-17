import { createCLI, createCmd } from '../createCli.ts';

await createCLI(
  { name: 'Multi Command CLI', baseCmd: 'multi-cli' },
  {
    'create': createCmd({
      description: 'Create a new project',
      short: 'c',
      args: {
        name: {
          type: 'positional-string',
          name: 'name',
          description: 'Project name',
        },
        template: {
          type: 'value-string-flag',
          name: 'template',
          description: 'Project template',
          default: 'basic',
        },
        verbose: {
          type: 'flag',
          name: 'verbose',
          description: 'Enable verbose output',
        },
      },
      examples: [
        { args: ['my-project'], description: 'Create project with default template' },
        { args: ['my-project', '--template', 'react'], description: 'Create React project' },
      ],
      run: async (args) => {
        console.log(`Creating project: ${args.name || 'unnamed'}`);
        console.log(`Template: ${args.template || 'basic'}`);
        if (args.verbose) console.log('Verbose mode enabled');
      },
    }),
    'deploy': createCmd({
      description: 'Deploy the application',
      short: 'd',
      args: {
        port: {
          type: 'positional-number',
          name: 'port',
          description: 'Port number',
          default: 3000,
        },
        env: {
          type: 'value-string-flag',
          name: 'env',
          description: 'Environment to deploy to',
        },
      },
      run: async (args) => {
        console.log(`Deploying on port: ${args.port || 3000}`);
        if (args.env) console.log(`Environment: ${args.env}`);
      },
    }),
    'status': createCmd({
      description: 'Check application status',
      run: async () => {
        console.log('Application is running');
      },
    }),
  },
);