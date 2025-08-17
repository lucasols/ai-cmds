import {
  cancel,
  intro,
  isCancel,
  log,
  outro,
  select,
  type Option,
} from '@clack/prompts';
import { getAscIndexOrder, sortBy } from '@ls-stack/utils/arrayUtils';
import { exhaustiveCheck } from '@ls-stack/utils/assertions';
import { dedent } from '@ls-stack/utils/dedent';
import { removeANSIColors } from '@ls-stack/utils/stringUtils';
import { isObjKey, typedObjectEntries } from '@ls-stack/utils/typingFnUtils';
import { styleText } from 'node:util';

const [, , cmdFromTerminal, ...cmdArgs] = process.argv;

type Cmd = {
  short?: string;
  description: string;
  run: (...args: any[]) => Promise<void> | void;
  args?: Record<string, Arg>;
  examples?: {
    args: string[];
    description: string;
  }[];
};

type PositionalArg =
  | {
      type: 'positional-string';
      name: string;
      default?: string;
      description: string;
    }
  | {
      type: 'positional-number';
      name: string;
      default?: number;
      description: string;
    };

type Arg =
  | PositionalArg
  | {
      type: 'flag';
      name: string;
      description: string;
    }
  | {
      type: 'value-string-flag';
      default?: string;
      name: string;
      description: string;
    }
  | {
      type: 'value-number-flag';
      default?: number;
      name: string;
      description: string;
    };

type GetArgType<T extends Arg> =
  T extends PositionalArg ?
    T['type'] extends 'positional-string' ?
      T['default'] extends string ?
        string
      : string | undefined
    : T['type'] extends 'positional-number' ?
      T['default'] extends number ?
        number
      : number | undefined
    : never
  : T extends { type: 'flag' } ? boolean
  : T extends { type: 'value-string-flag' } ?
    T['default'] extends string ?
      string
    : string | undefined
  : T extends { type: 'value-number-flag' } ?
    T['default'] extends number ?
      number
    : number | undefined
  : never;

export function createCmd<Args extends undefined | Record<string, Arg>>({
  short,
  description,
  run,
  args,
  examples,
}: {
  short?: string;
  description: string;
  args?: Args;
  run: (cmdArgs: {
    [K in keyof Args]: Args[K] extends Arg ? GetArgType<Args[K]> : never;
  }) => Promise<void> | void;
  examples?: {
    args: string[];
    description: string;
  }[];
}) {
  return {
    short,
    description,
    run,
    args,
    examples,
  };
}

export async function createCLI<C extends string>(
  {
    name,
    sort,
    baseCmd,
  }: { name: string; sort?: NoInfer<C>[]; baseCmd: string },
  cmds: Record<C, Cmd>,
) {
  function getCmdId(cmd: string): C {
    if (isObjKey(cmd, cmds)) {
      return cmd;
    }

    log.error(styleText(['red', 'bold'], `Command '${cmd}' not found`));
    process.exit(1);
  }


  console.clear();

  intro(styleText(['blue', 'bold'], name));

  const addedShortCmds = new Set<string>();

  let runCmdId: C | undefined = cmdFromTerminal as C | undefined;

  for (const [, cmd] of typedObjectEntries(cmds)) {
    if (cmd.short) {
      if (addedShortCmds.has(cmd.short)) {
        console.error(
          styleText(['red', 'bold'], `Short cmd "${cmd.short}" is duplicated`),
        );
        process.exit(1);
      }

      addedShortCmds.add(cmd.short);
    }
  }

  function printHelp() {
    const pipeChar = styleText(['dim'], ' or ');
    const fmtCmd = (c: string) => styleText(['blue', 'bold'], c);
    const beforeDescription = styleText(['dim'], '->');

    const largestCmdTextLength = Math.max(
      ...typedObjectEntries(cmds).map(
        ([cmd, { short }]) => `${cmd}${short ? ` or ${short}` : ''}`.length,
      ),
    );

    log.info(dedent`
      ${styleText(['blue', 'bold'], 'Docs:')}

      ${styleText(['bold', 'underline'], 'Usage:')} ${baseCmd} <command> [command-args...]

      ${styleText(['bold', 'underline'], 'Commands:')}

      ${typedObjectEntries(cmds)
        .map(([cmd, { description, short, args }]) => {
          const cmdText = `${fmtCmd(cmd)}${short ? `${pipeChar}${fmtCmd(short)}` : ''}`;
          const unformattedCmdText = removeANSIColors(cmdText);

          let result = `${cmdText}${' '.repeat(
            largestCmdTextLength - unformattedCmdText.length + 1,
          )}${beforeDescription} ${description}`;

          if (args && Object.keys(args).length > 0) {
            const briefArgs = typedObjectEntries(args)
              .sort(([, a], [, b]) => {
                // Positional args first (in declaration order), then flags
                if (a.type.startsWith('positional') && !b.type.startsWith('positional')) return -1;
                if (!a.type.startsWith('positional') && b.type.startsWith('positional')) return 1;
                return 0; // Keep original order within each group
              })
              .map(([, arg]) => {
                switch (arg.type) {
                  case 'positional-string':
                  case 'positional-number':
                    return `[${arg.name}]`;
                  case 'flag':
                    return `[--${arg.name}]`;
                  case 'value-string-flag':
                  case 'value-number-flag':
                    return `[--${arg.name}]`;
                  default:
                    throw exhaustiveCheck(arg);
                }
              })
              .join(' ');
            result += `\n${styleText(['dim'], ` └─ args: ${briefArgs}`)}`;
          }

          return result;
        })
        .join('\n')}

      ${styleText(['dim'], `Use ${baseCmd} <cmd> -h for more details about a command`)}

      ${fmtCmd('i')} ${beforeDescription} Starts in interactive mode
      ${fmtCmd('h')} ${beforeDescription} Prints this help message
    `);

    outro(styleText(['dim'], 'Use a command to get started!'));
  }

  function printCmdHelp(cmdId: string) {
    const cmd = cmds[getCmdId(cmdId)];

    function formatArg(arg: Arg): string {
      switch (arg.type) {
        case 'positional-string':
        case 'positional-number':
          return `[${arg.name}]`;
        case 'flag':
          return `[--${arg.name}]`;
        case 'value-string-flag':
          return `[--${arg.name} <value>]`;
        case 'value-number-flag':
          return `[--${arg.name} <number>]`;
        default:
          throw exhaustiveCheck(arg);
      }
    }

    function getArgsUsage(args?: Record<string, Arg>): string {
      if (!args) return '';

      const sortedArgs = typedObjectEntries(args).sort(([, a], [, b]) => {
        // Positional args first (in declaration order), then flags
        if (a.type.startsWith('positional') && !b.type.startsWith('positional')) return -1;
        if (!a.type.startsWith('positional') && b.type.startsWith('positional')) return 1;
        return 0; // Keep original order within each group
      });

      const colors = [
        'cyan',
        'yellow',
        'magenta',
        'blue',
        'green',
        'red',
      ] as const;
      return sortedArgs
        .map(([, arg], index) => {
          const color = colors[index % colors.length];

          if (!color) return formatArg(arg);

          return styleText([color], formatArg(arg)) || formatArg(arg);
        })
        .join(' ');
    }

    const cmdTitle = cmd.short ? `${cmdId} (${cmd.short})` : cmdId;
    let helpText = `${styleText(['blue', 'bold'], `${cmdTitle}:`) || `${cmdTitle}:`} ${cmd.description}\n\n${styleText(['bold', 'underline'], 'Usage:') || 'Usage:'} ${styleText(['dim'], baseCmd) || baseCmd} ${styleText(['bold'], cmdId) || cmdId}`;

    if (cmd.args) {
      const argsUsage = getArgsUsage(cmd.args);
      if (argsUsage) {
        helpText += ` ${argsUsage}`;
      }
    }
    
    if (cmd.short) {
      helpText += `\n       ${styleText(['dim'], baseCmd) || baseCmd} ${styleText(['bold'], cmd.short) || cmd.short} ...`;
    }

    if (cmd.args) {
      const argEntries = typedObjectEntries(cmd.args);
      if (argEntries.length > 0) {
        helpText += `\n\n${styleText(['bold', 'underline'], 'Arguments:') || 'Arguments:'}`;
        const colors = [
          'cyan',
          'yellow',
          'magenta',
          'blue',
          'green',
          'red',
        ] as const;
        argEntries.forEach(([, arg], index) => {
          const color = colors[index % colors.length];

          if (!color) return;

          const argDisplayName =
            arg.type === 'flag' ? `--${arg.name}`
            : arg.type === 'value-string-flag' ? `--${arg.name}`
            : arg.type === 'value-number-flag' ? `--${arg.name}`
            : arg.name;
          const argName = styleText([color], argDisplayName) || argDisplayName;
          const required = '';
          helpText += `\n  ${argName}${required} - ${arg.description}`;
        });
      }
    }

    if (cmd.examples) {
      helpText += `\n\n${styleText(['bold', 'underline'], 'Examples:') || 'Examples:'}`;
      cmd.examples.forEach(
        ({ args: exampleArgs, description: exampleDesc }) => {
          helpText += `\n  ${baseCmd} ${cmdId} ${exampleArgs.join(' ')} ${styleText(['dim'], `# ${exampleDesc}`) || `# ${exampleDesc}`}`;
        },
      );
    }

    log.info(helpText);
    outro(styleText(['dim'], 'Use a command to get started!'));
  }

  if (!cmdFromTerminal) {
    const response = await select({
      message: 'Choose an action',
      options: [
        {
          value: 'run-cmd',
          label: `Start interactive mode`,
          hint: `Select a command to run from a list | ${baseCmd} i`,
        },
        {
          value: 'print-help',
          label: `Print help`,
          hint: `${baseCmd} h`,
        },
      ],
    });

    if (isCancel(response)) {
      cancel('Bye!');
      process.exit(0);
    }

    if (response === 'print-help') {
      printHelp();
      process.exit(0);
    } else {
      runCmdId = 'i' as C;
    }
  }

  if (
    runCmdId === '-h' ||
    runCmdId === '--help' ||
    runCmdId === 'help' ||
    runCmdId === 'h'
  ) {
    printHelp();
    process.exit(0);
  }

  function parseArgs(rawArgs: string[], commandArgs?: Record<string, Arg>): Record<string, any> {
    if (!commandArgs) return {};

    const parsed: Record<string, any> = {};
    const argEntries = typedObjectEntries(commandArgs);
    
    // Initialize with defaults
    argEntries.forEach(([key, argDef]) => {
      if ('default' in argDef && argDef.default !== undefined) {
        parsed[key] = argDef.default;
      }
    });

    // Parse positional arguments (use object declaration order)
    const positionalArgs = argEntries
      .filter(([, argDef]) => argDef.type.startsWith('positional'));

    let positionalIndex = 0;
    let i = 0;
    
    while (i < rawArgs.length) {
      const currentArg = rawArgs[i];
      
      if (currentArg?.startsWith('--')) {
        // Handle flags
        const flagName = currentArg.slice(2);
        const flagEntry = argEntries.find(([, argDef]) => argDef.name === flagName);
        
        if (flagEntry) {
          const [key, argDef] = flagEntry;
          
          if (argDef.type === 'flag') {
            parsed[key] = true;
            i++;
          } else if (argDef.type === 'value-string-flag' || argDef.type === 'value-number-flag') {
            const value = rawArgs[i + 1];
            if (value && !value.startsWith('--')) {
              if (argDef.type === 'value-number-flag') {
                const numValue = Number(value);
                if (isNaN(numValue)) {
                  log.error(styleText(['red', 'bold'], `Error: Invalid number "${value}" for --${argDef.name}`));
                  process.exit(1);
                }
                parsed[key] = numValue;
              } else {
                parsed[key] = value;
              }
              i += 2;
            } else {
              log.error(styleText(['red', 'bold'], `Error: Missing value for --${argDef.name}`));
              process.exit(1);
            }
          } else {
            i++;
          }
        } else {
          log.error(styleText(['red', 'bold'], `Error: Unknown flag --${flagName}`));
          process.exit(1);
        }
      } else {
        // Handle positional arguments
        if (positionalIndex < positionalArgs.length) {
          const positionalEntry = positionalArgs[positionalIndex];
          if (positionalEntry) {
            const [key, argDef] = positionalEntry;
            if (argDef.type === 'positional-number') {
              const numValue = Number(currentArg);
              if (isNaN(numValue)) {
                log.error(styleText(['red', 'bold'], `Error: Invalid number "${currentArg}" for ${argDef.name}`));
                process.exit(1);
              }
              parsed[key] = numValue;
            } else {
              parsed[key] = currentArg;
            }
            positionalIndex++;
          }
        }
        i++;
      }
    }

    return parsed;
  }

  async function runCmd(cmd: string, args: string[]) {
    console.clear();

    for (const [cmdId, { short, run: fn, args: commandArgs }] of typedObjectEntries(cmds)) {
      if (cmd === short || cmd === cmdId) {
        // Check if help is requested for this specific command
        if (args.includes('-h') || args.includes('--help')) {
          printCmdHelp(cmdId);
          process.exit(0);
        }

        log.info(
          `Running ${styleText(['blue', 'bold'], cmdId)}${short ? styleText(['dim'], `|${short}`) : ''}:\n`,
        );

        const parsedArgs = parseArgs(args, commandArgs);
        await fn(parsedArgs);
        process.exit(0);
      }
    }

    log.error(styleText(['red', 'bold'], `Command '${cmd}' not found`));
    printHelp();
    process.exit(1);
  }

  if (runCmdId === 'i') {
    let cmdEntries = typedObjectEntries(cmds);

    if (sort) {
      cmdEntries = sortBy(cmdEntries, ([cmd]) =>
        getAscIndexOrder(sort.indexOf(cmd)),
      );
    }

    const response = await select({
      message: 'Select a command',
      options: cmdEntries.map(
        ([cmd, { short, description }]): Option<string> => ({
          value: cmd,
          label: short ? `${cmd} ${styleText(['dim'], '|')} ${short}` : cmd,
          hint: description,
        }),
      ),
    });

    if (isCancel(response)) {
      cancel('Cancelled!');
      process.exit(0);
    }

    await runCmd(response, []);
  } else {
    if (!runCmdId) {
      log.error(
        styleText(
          ['red', 'bold'],
          `Command not found, use \`${baseCmd} h\` to list all supported commands`,
        ),
      );
      outro(styleText(['dim'], 'Use a command to get started!'));
      process.exit(1);
    }

    await runCmd(runCmdId, cmdArgs);
  }
}
