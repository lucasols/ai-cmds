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
import { dedent } from '@ls-stack/utils/dedent';
import { removeANSIColors } from '@ls-stack/utils/stringUtils';
import { typedObjectEntries } from '@ls-stack/utils/typingFnUtils';
import { styleText } from 'node:util';

const [, , cmdFromTerminal, ...cmdArgs] = process.argv;

type Cmd = {
  short?: string;
  description: string;
  run: (...args: any[]) => Promise<void> | void;
  args?: Record<string, Arg>;
};

type PositionalArg = {
  type: 'positional-string' | 'positional-number';
  pos: number;
  required: boolean;
  name: string;
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
      type: 'value-flag';
      valueType: 'string' | 'number';
      required: boolean;
      name: string;
      description: string;
    };

type GetArgType<T extends Arg> =
  T extends PositionalArg & { required: false } ?
    T['type'] extends 'positional-string' ? string | undefined
    : T['type'] extends 'positional-number' ? number | undefined
    : never
  : T extends PositionalArg & { required: true } ?
    T['type'] extends 'positional-string' ? string
    : T['type'] extends 'positional-number' ? number
    : never
  : T extends { type: 'flag' } ? boolean
  : T extends { type: 'value-flag'; required: false } ?
    T['valueType'] extends 'string' ? string | undefined
    : T['valueType'] extends 'number' ? number | undefined
    : never
  : T extends { type: 'value-flag'; required: true } ?
    T['valueType'] extends 'string' ? string
    : T['valueType'] extends 'number' ? number
    : never
  : never;

export function createCmd<Args extends undefined | Record<string, Arg>>({
  short,
  description,
  run,
  args,
}: {
  short?: string;
  description: string;
  args?: Args;
  run: (cmdArgs: {
    [K in keyof Args]: Args[K] extends Arg ? GetArgType<Args[K]> : never;
  }) => Promise<void> | void;
}) {
  return {
    short,
    description,
    run,
    args,
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
        .map(([cmd, { description, short }]) => {
          const cmdText = `${fmtCmd(cmd)}${short ? `${pipeChar}${fmtCmd(short)}` : ''}`;

          const unformattedCmdText = removeANSIColors(cmdText);

          return `${cmdText}${' '.repeat(
            largestCmdTextLength - unformattedCmdText.length + 1,
          )}${beforeDescription} ${description}`;
        })
        .join('\n')}

      ${fmtCmd('i')} ${beforeDescription} Starts in interactive mode
      ${fmtCmd('h')} ${beforeDescription} Prints this help message
    `);

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

  async function runCmd(cmd: string, args: string[]) {
    console.clear();

    for (const [cmdId, { short, run: fn }] of typedObjectEntries(cmds)) {
      if (cmd === short || cmd === cmdId) {
        log.info(
          `Running ${styleText(['blue', 'bold'], cmdId)}${short ? styleText(['dim'], `|${short}`) : ''}:\n`,
        );

        await fn(args);
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
