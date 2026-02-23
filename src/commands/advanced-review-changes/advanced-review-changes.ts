import { cliInput, createCmd } from '@ls-stack/cli';
import { showErrorAndExit } from '../../lib/shell.ts';
import {
  runLocalReviewChangesWorkflow,
  type LocalReviewInstructionSelection,
} from '../review-code-changes/review-code-changes.ts';

function parseBooleanOption(
  value: string | undefined,
  optionName: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (
    normalizedValue === 'true' ||
    normalizedValue === '1' ||
    normalizedValue === 'yes' ||
    normalizedValue === 'y'
  ) {
    return true;
  }

  if (
    normalizedValue === 'false' ||
    normalizedValue === '0' ||
    normalizedValue === 'no' ||
    normalizedValue === 'n'
  ) {
    return false;
  }

  showErrorAndExit(
    `Invalid value for ${optionName}: ${value}. Use true or false.`,
  );
}

export const advancedReviewChangesCommand = createCmd({
  description: 'Review local code changes with advanced review controls',
  short: 'arc',
  args: {
    setup: {
      type: 'value-string-flag',
      name: 'setup',
      description: 'Review setup (light, medium, heavy)',
    },
    scope: {
      type: 'value-string-flag',
      name: 'scope',
      description: 'Review scope (all, staged)',
    },
    baseBranch: {
      type: 'value-string-flag',
      name: 'base-branch',
      description: 'Base branch for diff comparison',
    },
    output: {
      type: 'value-string-flag',
      name: 'output',
      description: 'Output file path for the generated review markdown',
    },
    customReviewInstruction: {
      type: 'value-string-flag',
      name: 'custom-review-instruction',
      description:
        'Extra instruction to focus the review on specific issue types',
    },
    includeDefaultReviewInstructions: {
      type: 'value-string-flag',
      name: 'include-default-review-instructions',
      description:
        'Whether to include configured/default review instructions (true/false)',
    },
  },
  examples: [
    { args: ['--scope', 'staged'], description: 'Review staged changes' },
    { args: ['--scope', 'all'], description: 'Review all changes vs base' },
    { args: ['--setup', 'light'], description: 'Use light review setup' },
    {
      args: ['--scope', 'all', '--output', 'reviews/local-review.md'],
      description: 'Save the review to a custom file path',
    },
    {
      args: ['--custom-review-instruction', 'Focus on security and auth bugs'],
      description: 'Add custom review focus instruction',
    },
    {
      args: ['--include-default-review-instructions', 'false'],
      description: 'Review using only custom instructions',
    },
  ],
  run: async ({
    setup,
    scope,
    baseBranch,
    output,
    customReviewInstruction,
    includeDefaultReviewInstructions,
  }) => {
    await runLocalReviewChangesWorkflow({
      setup,
      scope,
      baseBranch,
      output,
      commandId: 'advanced-review-changes',
      resolveInstructionSelection: async () => {
        const shouldIncludeDefaultReviewInstructions =
          parseBooleanOption(
            includeDefaultReviewInstructions,
            '--include-default-review-instructions',
          ) ?? true;

        let resolvedCustomReviewInstruction = customReviewInstruction?.trim();
        if (!resolvedCustomReviewInstruction) {
          const shouldAddCustomReviewInstruction = await cliInput.confirm(
            'Add a custom review instruction to focus this review?',
            {
              initial: false,
            },
          );

          if (shouldAddCustomReviewInstruction) {
            resolvedCustomReviewInstruction = (
              await cliInput.text('Enter custom review instruction', {
                validate: (value) =>
                  value.trim().length > 0 || 'Instruction cannot be empty',
              })
            ).trim();
          }
        }

        return {
          includeDefaultReviewInstructions:
            shouldIncludeDefaultReviewInstructions,
          customReviewInstruction: resolvedCustomReviewInstruction,
        } satisfies LocalReviewInstructionSelection;
      },
    });
  },
});
