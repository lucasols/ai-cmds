import { cliInput, createCmd } from '@ls-stack/cli';
import { dedent } from '@ls-stack/utils/dedent';
import { writeFile } from 'fs/promises';
import path from 'path';
import { estimateTokenCount } from 'tokenx';
import {
  getExcludePatterns,
  loadConfig,
  resolveBaseBranch,
  type ScopeConfig,
  type ScopeContext,
} from '../../lib/config.ts';
import { formatNum, removeImportOnlyChangesFromDiff } from '../../lib/diff.ts';
import { git } from '../../lib/git.ts';
import { github, type PRData } from '../../lib/github.ts';
import { runCmdSilentUnwrap, showErrorAndExit } from '../../lib/shell.ts';
import {
  calculateReviewsUsage,
  calculateTotalUsage,
  formatValidatedReview,
  handleOutput,
  logTokenUsageBreakdown,
} from './output.ts';
import { reviewValidator, runSingleReview } from './reviewer.ts';
import {
  getAvailableScopes,
  resolveScope,
  tryGetFileCountSync,
} from './scopes.ts';
import {
  getAvailableSetups,
  resolveSetup,
  type ReviewSetupConfig,
} from './setups.ts';
import type { IndividualReview, PRReviewContext } from './types.ts';

const MAX_DIFF_TOKENS = 60_000;

/**
 * Fetches all file lists needed for scope context.
 * Returns staged files, PR files (if PR number provided), and all changed files vs base branch.
 */
async function fetchAllFileLists(
  prNumber: string | null,
  baseBranch: string,
): Promise<{
  prData: PRData | null;
  scopeContext: ScopeContext;
}> {
  // Fetch staged files
  const stagedFilesPromise = runCmdSilentUnwrap([
    'git',
    'diff',
    '--cached',
    '--name-only',
  ]).then((output) => output.trim().split('\n').filter(Boolean));

  // Fetch all changed files vs base branch
  const allFilesPromise = (async () => {
    await runCmdSilentUnwrap([
      'git',
      'fetch',
      'origin',
      `${baseBranch}:${baseBranch}`,
    ]).catch(() => {
      // Ignore errors if branch doesn't exist on remote or is already up to date
    });

    const output = await runCmdSilentUnwrap([
      'git',
      'diff',
      '--name-only',
      `origin/${baseBranch}...HEAD`,
    ]);
    return output.trim().split('\n').filter(Boolean);
  })();

  // Fetch PR data and files if PR number provided
  let prData: PRData | null = null;
  let prFiles: string[] | null = null;

  if (prNumber) {
    [prData, prFiles] = await Promise.all([
      github.getPRData(prNumber),
      github.getChangedFiles(prNumber),
    ]);
  }

  const [stagedFiles, allFiles] = await Promise.all([
    stagedFilesPromise,
    allFilesPromise,
  ]);

  return {
    prData,
    scopeContext: {
      stagedFiles,
      // Use PR files when PR is provided, otherwise use all changed files vs base
      allFiles: prFiles ?? allFiles,
    },
  };
}

/**
 * Gets the diff for the selected files.
 */
async function getDiffForFiles(
  files: string[],
  options: {
    baseBranch: string;
    excludeFiles?: string[];
    useStaged: boolean;
  },
): Promise<string> {
  const { baseBranch, excludeFiles, useStaged } = options;

  if (useStaged) {
    const rawDiff = await git.getStagedDiff({
      includeFiles: files,
      ignoreFiles: excludeFiles,
      silent: true,
    });

    const prDiff = removeImportOnlyChangesFromDiff(rawDiff);

    console.log(
      `📝 Staged diff: ${Math.round(prDiff.length / 1024)}KB, ${prDiff.split('\n').length} lines, ${formatNum(estimateTokenCount(prDiff))} tokens`,
    );

    return prDiff;
  }

  const rawDiff = await git.getDiffToBranch(baseBranch, {
    includeFiles: files,
    ignoreFiles: excludeFiles,
    silent: true,
  });

  const prDiff = removeImportOnlyChangesFromDiff(rawDiff);

  console.log(
    `📝 Diff: ${Math.round(prDiff.length / 1024)}KB, ${prDiff.split('\n').length} lines, ${formatNum(estimateTokenCount(prDiff))} tokens`,
  );

  return prDiff;
}

/**
 * Applies exclude patterns to a file list.
 */
function applyExcludePatterns(
  files: string[],
  excludePatterns?: string[],
): string[] {
  if (!excludePatterns || excludePatterns.length === 0) {
    return files;
  }

  return files.filter(
    (file) =>
      !excludePatterns.some((pattern) => path.matchesGlob(file, pattern)),
  );
}

export const reviewCodeChangesCommand = createCmd({
  description: 'Review code with AI',
  short: 'rc',
  args: {
    setup: {
      type: 'value-string-flag',
      name: 'setup',
      description:
        'Review setup (veryLight, lightGoogle, mediumGoogle, light, medium, heavy)',
    },
    scope: {
      type: 'value-string-flag',
      name: 'scope',
      description: 'Review scope (all, staged, pr)',
    },
    pr: {
      type: 'value-string-flag',
      name: 'pr',
      description: 'PR number to review',
    },
    baseBranch: {
      type: 'value-string-flag',
      name: 'base-branch',
      description: 'Base branch for diff comparison',
    },
  },
  examples: [
    { args: ['--scope', 'staged'], description: 'Review staged changes' },
    { args: ['--pr', '123'], description: 'Review PR #123' },
    { args: ['--setup', 'light'], description: 'Use light review setup' },
  ],
  run: async ({ setup, scope, pr, baseBranch }) => {
    const rootConfig = await loadConfig();
    const config = rootConfig.reviewCodeChanges ?? {};

    // Resolve setup from CLI arg or interactive selection
    let setupConfig: ReviewSetupConfig | undefined = resolveSetup(
      config,
      setup,
    );
    let setupLabel = setup;

    if (setup && !setupConfig) {
      const availableSetups = getAvailableSetups(config);
      showErrorAndExit(
        `Invalid setup: ${setup}. Valid options: ${availableSetups.join(', ')}`,
      );
    }

    if (!setupConfig) {
      // Interactive selection - use custom setups if configured, otherwise built-in
      const builtInOptions = [
        { value: 'light', label: 'Light - 1 GPT-5 reviewer' },
        { value: 'medium', label: 'Medium - 2 GPT-5 reviewers' },
        { value: 'heavy', label: 'Heavy - 4 GPT-5 reviewers' },
      ];

      const customOptions =
        config.setup?.map((s) => ({
          value: s.label,
          label: s.label,
        })) ?? [];

      // If custom setups are configured, use only those; otherwise use built-in
      const options = customOptions.length > 0 ? customOptions : builtInOptions;

      const selectedSetup = await cliInput.select('Select the review setup', {
        options,
      });

      setupLabel = selectedSetup;
      setupConfig = resolveSetup(config, selectedSetup);

      if (!setupConfig) {
        showErrorAndExit(`Failed to resolve setup: ${selectedSetup}`);
      }
    }

    // Get PR number first (needed for fetching file lists)
    let prNumber: string | null = pr ?? null;

    const currentBranch = git.getCurrentBranch();

    // Resolve base branch (supports function form)
    const resolvedBaseBranch =
      baseBranch ?? resolveBaseBranch(config.baseBranch, currentBranch, 'main');

    // Fetch all file lists upfront for scope context
    console.log('\n🔄 Fetching file lists...');
    const { prData, scopeContext } = await fetchAllFileLists(
      prNumber,
      resolvedBaseBranch,
    );

    // If PR number was provided, update base branch from PR data
    const effectiveBaseBranch = prData?.baseRefName ?? resolvedBaseBranch;

    // Resolve scope from CLI arg or interactive selection
    let scopeConfig: ScopeConfig | undefined = resolveScope(config, scope);
    let scopeLabel = scope;

    if (scope && !scopeConfig) {
      const availableScopes = getAvailableScopes(config);
      showErrorAndExit(
        `Invalid scope: ${scope}. Valid options: ${availableScopes.join(', ')}`,
      );
    }

    if (!scopeConfig) {
      // Interactive selection - use custom scopes if configured, otherwise built-in
      const builtInOptions = [
        {
          value: 'all',
          label: `All changes (${scopeContext.allFiles.length} files)`,
        },
        {
          value: 'staged',
          label: `Staged changes (${scopeContext.stagedFiles.length} files)`,
        },
        {
          value: 'pr',
          label: `PR changes${prNumber ? ` (${scopeContext.allFiles.length} files)` : ' (enter PR number)'}`,
        },
      ];

      const customOptions =
        config.scope?.map((s) => {
          const fileCount = tryGetFileCountSync(s, scopeContext);
          return {
            value: s.label,
            label:
              fileCount !== null ? `${s.label} (${fileCount} files)` : s.label,
          };
        }) ?? [];

      // If custom scopes are configured, use only those; otherwise use built-in
      const options = customOptions.length > 0 ? customOptions : builtInOptions;

      const selectedScope = await cliInput.select('Select the review scope', {
        options,
      });

      scopeLabel = selectedScope;
      scopeConfig = resolveScope(config, selectedScope);

      if (!scopeConfig) {
        showErrorAndExit(`Failed to resolve scope: ${selectedScope}`);
      }
    }

    // Handle PR scope that needs PR number
    if (scopeLabel === 'pr' && !prNumber) {
      const prInput = await cliInput.text('Enter PR number');
      prNumber = prInput;

      // Re-fetch PR files with the new PR number
      console.log(`🔄 Fetching PR #${prNumber} files...`);
      const { prData: newPrData, scopeContext: newScopeContext } =
        await fetchAllFileLists(prNumber, resolvedBaseBranch);

      // Update scope context with PR files
      scopeContext.allFiles = newScopeContext.allFiles;

      // Update prData if it was fetched
      if (newPrData) {
        Object.assign(prData ?? {}, newPrData);
      }
    }

    // Get files using the scope's getFiles function
    const scopeFiles = await scopeConfig.getFiles(scopeContext);
    const excludePatterns = getExcludePatterns(config);
    const changedFiles = applyExcludePatterns(scopeFiles, excludePatterns);

    if (changedFiles.length === 0) {
      showErrorAndExit(
        `No files found for scope "${scopeLabel}"${excludePatterns ? ' after applying exclude patterns' : ''}`,
      );
    }

    if (excludePatterns && scopeFiles.length !== changedFiles.length) {
      const excludedCount = scopeFiles.length - changedFiles.length;
      console.log(
        `📂 Reviewing ${changedFiles.length} files (${excludedCount} files filtered out)`,
      );
    }

    const sourceDescription =
      scopeLabel === 'staged' ? 'staged changes'
      : prNumber ? `PR #${prNumber}`
      : `${currentBranch} vs ${effectiveBaseBranch}`;

    console.log(`\n🔄 Processing ${sourceDescription}...`);

    console.log(
      `📋 Using ${setupLabel} setup with ${setupConfig.reviewers.length} reviewer(s)\n`,
    );

    // Get diff for the selected files
    const useStaged = scopeLabel === 'staged';
    const prDiff = await getDiffForFiles(changedFiles, {
      baseBranch: effectiveBaseBranch,
      excludeFiles: excludePatterns,
      useStaged,
    });

    const diffTokens = estimateTokenCount(prDiff);

    if (diffTokens > MAX_DIFF_TOKENS) {
      console.warn(
        `⚠️ Warning: PR has ${formatNum(diffTokens)} tokens in the diff (max recommended: ${formatNum(MAX_DIFF_TOKENS)})`,
      );
    }

    // Create context
    const context: PRReviewContext = {
      mode: 'local',
      isTestGhMode: false,
      prNumber,
      additionalInstructions: undefined,
    };

    // Run reviews
    console.log(
      `🔍 Running ${setupConfig.reviewers.length} independent reviews...`,
    );

    const reviewPromises = setupConfig.reviewers.map((model, index) =>
      runSingleReview(
        context,
        prData,
        changedFiles,
        prDiff,
        index + 1,
        model,
        config.reviewInstructionsPath,
      ),
    );

    const successfulReviews: IndividualReview[] = [];

    const results = await Promise.allSettled(reviewPromises);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        successfulReviews.push(result.value);
      } else {
        console.error('Review failed:', result.reason);
      }
    }

    if (successfulReviews.length === 0) {
      showErrorAndExit('All reviewers failed - cannot proceed with review');
    }

    console.log('\n');

    // Fetch human comments if reviewing a PR
    let humanComments;
    if (prNumber) {
      console.log('📥 Fetching human review comments...');
      try {
        humanComments = await github.getAllHumanPRComments(prNumber);
        console.log(
          `📋 Found ${humanComments.length} general comments from humans`,
        );
      } catch (error) {
        console.warn('⚠️ Failed to fetch human comments:', error);
      }
    }

    // Run validation
    console.log('🔍 Running feedback checker to validate findings...');
    const validatedReview = await reviewValidator(
      context,
      successfulReviews,
      prData,
      changedFiles,
      prDiff,
      humanComments,
      setupConfig.validator,
      setupConfig.formatter,
      config.reviewInstructionsPath,
    );
    console.log(
      `✅ Validation complete - found ${validatedReview.issues.length} validated issues`,
    );

    // Log usage
    const reviewsUsage = calculateReviewsUsage(successfulReviews);
    const totalUsage = calculateTotalUsage([
      ...successfulReviews.map((review) => review.usage),
      validatedReview.usage,
      validatedReview.formatterUsage,
    ]);

    logTokenUsageBreakdown(
      reviewsUsage,
      validatedReview.usage,
      validatedReview.formatterUsage,
    );

    console.log(
      dedent`
        📊 Tokens:
          Total: ${formatNum(totalUsage.totalTokens || 0)}
          Input: ${formatNum(totalUsage.promptTokens || 0)}
          Output: ${formatNum(totalUsage.completionTokens || 0)}
          Reasoning: ${formatNum(totalUsage.reasoningTokens || 0)}
      `,
    );

    // Format and output review
    console.log('📝 Formatting review...');
    const authorLogin = prData?.author.login ?? 'local';
    const headRefName = prData?.headRefName ?? currentBranch;
    const reviewContent = await formatValidatedReview(
      validatedReview,
      authorLogin,
      context,
      headRefName,
      {
        reviews: successfulReviews,
        validatorUsage: validatedReview.usage,
        formatterUsage: validatedReview.formatterUsage,
      },
    );

    // Write to file
    const outputFile = 'pr-review.md';
    await writeFile(outputFile, reviewContent);

    // Handle output
    await handleOutput(context, reviewContent);
  },
});
