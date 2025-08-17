import { removeANSIColors } from '@ls-stack/utils/stringUtils';
import { execSync } from 'child_process';
import { describe, expect, it } from 'vitest';

type CLIResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function runCLI(fixture: string, args: string[] = []): CLIResult {
  const fixturePath = `src/test-fixtures/${fixture}`;
  const command = `tsx ${fixturePath} ${args.join(' ')}`.trim();

  try {
    const stdout = execSync(command, {
      encoding: 'utf8',
      timeout: 5000,
      cwd: process.cwd(),
    });

    return {
      stdout: removeANSIColors(stdout),
      stderr: '',
      exitCode: 0,
    };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: removeANSIColors(execError.stdout || ''),
      stderr: removeANSIColors(execError.stderr || ''),
      exitCode: execError.status || 1,
    };
  }
}

describe('createCLI', () => {
  describe('Basic CLI', () => {
    it('should display help with -h flag', () => {
      const result = runCLI('basic-cli.ts', ['-h']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Basic CLI
        │
        ●  Docs:
        │  
        │  Usage: basic-cli <command> [command-args...]
        │  
        │  Commands:
        │  
        │  hello or hi -> Say hello to someone
        │  
        │  Use basic-cli <cmd> -h for more details about a command
        │  
        │  i -> Starts in interactive mode
        │  h -> Prints this help message
        │
        └  Use a command to get started!

        "
      `);
    });

    it('should display help with --help flag', () => {
      const result = runCLI('basic-cli.ts', ['--help']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Basic CLI
        │
        ●  Docs:
        │  
        │  Usage: basic-cli <command> [command-args...]
        │  
        │  Commands:
        │  
        │  hello or hi -> Say hello to someone
        │  
        │  Use basic-cli <cmd> -h for more details about a command
        │  
        │  i -> Starts in interactive mode
        │  h -> Prints this help message
        │
        └  Use a command to get started!

        "
      `);
    });

    it('should display help with h command (not hello)', () => {
      const result = runCLI('basic-cli.ts', ['h']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Basic CLI
        │
        ●  Docs:
        │  
        │  Usage: basic-cli <command> [command-args...]
        │  
        │  Commands:
        │  
        │  hello or hi -> Say hello to someone
        │  
        │  Use basic-cli <cmd> -h for more details about a command
        │  
        │  i -> Starts in interactive mode
        │  h -> Prints this help message
        │
        └  Use a command to get started!

        "
      `);
    });

    it('should execute hello command', () => {
      const result = runCLI('basic-cli.ts', ['hello']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Basic CLI
        │
        ●  Running hello|hi:
        │  
        Hello World!
        "
      `);
    });

    it('should execute hello command with short alias', () => {
      const result = runCLI('basic-cli.ts', ['hi']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Basic CLI
        │
        ●  Running hello|hi:
        │  
        Hello World!
        "
      `);
    });

    it('should show error for unknown command', () => {
      const result = runCLI('basic-cli.ts', ['unknown']);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Basic CLI
        │
        ■  Command 'unknown' not found
        │
        ●  Docs:
        │  
        │  Usage: basic-cli <command> [command-args...]
        │  
        │  Commands:
        │  
        │  hello or hi -> Say hello to someone
        │  
        │  Use basic-cli <cmd> -h for more details about a command
        │  
        │  i -> Starts in interactive mode
        │  h -> Prints this help message
        │
        └  Use a command to get started!

        "
      `);
    });
  });

  describe('Multi Command CLI', () => {
    it('should display main help', () => {
      const result = runCLI('multi-command-cli.ts', ['-h']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  Docs:
        │  
        │  Usage: multi-cli <command> [command-args...]
        │  
        │  Commands:
        │  
        │  create or c -> Create a new project
        │   └─ args: [name] [--template] [--verbose]
        │  deploy or d -> Deploy the application
        │   └─ args: [port] [--env]
        │  status      -> Check application status
        │  
        │  Use multi-cli <cmd> -h for more details about a command
        │  
        │  i -> Starts in interactive mode
        │  h -> Prints this help message
        │
        └  Use a command to get started!

        "
      `);
    });

    it('should display create command help', () => {
      const result = runCLI('multi-command-cli.ts', ['create', '-h']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  create (c): Create a new project
        │  
        │  Usage: multi-cli create [name] [--template <value>] [--verbose]
        │         multi-cli c ...
        │  
        │  Arguments:
        │    name - Project name
        │    --template - Project template
        │    --verbose - Enable verbose output
        │  
        │  Examples:
        │    multi-cli create my-project # Create project with default template
        │    multi-cli create my-project --template react # Create React project
        │
        └  Use a command to get started!

        "
      `);
    });

    it('should display deploy command help', () => {
      const result = runCLI('multi-command-cli.ts', ['deploy', '-h']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  deploy (d): Deploy the application
        │  
        │  Usage: multi-cli deploy [port] [--env <value>]
        │         multi-cli d ...
        │  
        │  Arguments:
        │    port - Port number
        │    --env - Environment to deploy to
        │
        └  Use a command to get started!

        "
      `);
    });

    it('should execute create command with positional arg', () => {
      const result = runCLI('multi-command-cli.ts', ['create', 'my-project']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  Running create|c:
        │  
        Creating project: my-project
        Template: basic
        "
      `);
    });

    it('should execute create command with flags', () => {
      const result = runCLI('multi-command-cli.ts', [
        'create',
        'my-project',
        '--template',
        'react',
        '--verbose',
      ]);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  Running create|c:
        │  
        Creating project: my-project
        Template: react
        Verbose mode enabled
        "
      `);
    });

    it('should execute deploy command with default port', () => {
      const result = runCLI('multi-command-cli.ts', ['deploy']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  Running deploy|d:
        │  
        Deploying on port: 3000
        "
      `);
    });

    it('should execute deploy command with custom port', () => {
      const result = runCLI('multi-command-cli.ts', ['deploy', '8080']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  Running deploy|d:
        │  
        Deploying on port: 8080
        "
      `);
    });

    it('should execute deploy command with environment flag', () => {
      const result = runCLI('multi-command-cli.ts', [
        'deploy',
        '--env',
        'production',
      ]);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  Running deploy|d:
        │  
        Deploying on port: 3000
        Environment: production
        "
      `);
    });

    it('should execute status command', () => {
      const result = runCLI('multi-command-cli.ts', ['status']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  Running status:
        │  
        Application is running
        "
      `);
    });

    it('should execute create command with short alias', () => {
      const result = runCLI('multi-command-cli.ts', ['c', 'test-project']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  Running create|c:
        │  
        Creating project: test-project
        Template: basic
        "
      `);
    });

    it('should execute deploy command with short alias', () => {
      const result = runCLI('multi-command-cli.ts', ['d', '9000']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Multi Command CLI
        │
        ●  Running deploy|d:
        │  
        Deploying on port: 9000
        "
      `);
    });
  });

  describe('Argument Validation', () => {
    it('should show error for invalid number in positional argument', () => {
      const result = runCLI('validation-cli.ts', ['server', 'abc']);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Validation CLI
        │
        ●  Running server:
        │  
        │
        ■  Error: Invalid number "abc" for port
        "
      `);
    });

    it('should show error for invalid number in value flag', () => {
      const result = runCLI('validation-cli.ts', ['server', '3000', '--timeout', 'invalid']);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Validation CLI
        │
        ●  Running server:
        │  
        │
        ■  Error: Invalid number "invalid" for --timeout
        "
      `);
    });

    it('should show error for missing value in value flag', () => {
      const result = runCLI('validation-cli.ts', ['server', '3000', '--config']);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Validation CLI
        │
        ●  Running server:
        │  
        │
        ■  Error: Missing value for --config
        "
      `);
    });

    it('should show error for unknown flag', () => {
      const result = runCLI('validation-cli.ts', ['server', '3000', '--unknown']);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Validation CLI
        │
        ●  Running server:
        │  
        │
        ■  Error: Unknown flag --unknown
        "
      `);
    });

    it('should work with valid arguments', () => {
      const result = runCLI('validation-cli.ts', ['server', '8080', '--timeout', '30', '--config', 'app.json']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Validation CLI
        │
        ●  Running server:
        │  
        Starting server on port: 8080
        Timeout: 30s
        Config: app.json
        "
      `);
    });
  });

  describe('Positional Argument Order', () => {
    it('should use declaration order for positional arguments', () => {
      const result = runCLI('order-test-cli.ts', ['order', 'hello', '42', 'world', '--verbose']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Order Test CLI
        │
        ●  Running order:
        │  
        First: hello
        Second: 42
        Third: world
        Verbose enabled
        "
      `);
    });

    it('should show help with proper argument order', () => {
      const result = runCLI('order-test-cli.ts', ['order', '-h']);
      expect(result.stdout).toMatchInlineSnapshot(`
        "┌  Order Test CLI
        │
        ●  order: Test positional argument order
        │  
        │  Usage: order-test-cli order [first] [second] [third] [--verbose]
        │  
        │  Arguments:
        │    first - First argument
        │    second - Second argument
        │    third - Third argument
        │    --verbose - Enable verbose output
        │
        └  Use a command to get started!

        "
      `);
    });
  });

});
