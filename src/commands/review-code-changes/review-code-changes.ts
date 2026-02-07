import { cliInput, createCmd } from '@ls-stack/cli';
import { createAsyncQueueWithMeta } from '@ls-stack/utils/asyncQueue';
import { dedent } from '@ls-stack/utils/dedent';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { estimateTokenCount } from 'tokenx';
import {
  getExcludePatterns,
  loadConfig,
  type ReviewConcurrencyConfig,
  resolveBaseBranch,
  resolveLogsDir,
  type ScopeConfig,
  type ScopeContext,
} from '../../lib/config.ts';
import { formatNum } from '../../lib/diff.ts';
import { git } from '../../lib/git.ts';
import {
  runCmdSilent,
  runCmdSilentUnwrap,
} from '@ls-stack/node-utils/runShellCmd';
import { showErrorAndExit } from '../../lib/shell.ts';
import { applyExcludePatterns, getDiffForFiles } from '../shared/diff-utils.ts';
import {
  calculateReviewsUsage,
  calculateTotalUsage,
  createZeroTokenUsage,
  formatValidatedReview,
  handleOutput,
  logTokenUsageBreakdown,
  logValidatedIssueSummary,
} from '../shared/output.ts';
import { reviewValidator, runSingleReview } from '../shared/reviewer.ts';
import { persistReviewRunLogs } from '../shared/review-logs.ts';
import {
  BUILT_IN_SCOPE_OPTIONS,
  getAvailableScopes,
  resolveScope,
  scopeConfigsToOptions,
} from '../shared/scopes.ts';
import {
  BUILT_IN_SETUP_OPTIONS,
  getAvailableSetups,
  resolveSetup,
  setupConfigsToOptions,
  type ReviewSetupConfig,
} from '../shared/setups.ts';
import type { IndividualReview, LocalReviewContext } from '../shared/types.ts';

const MAX_DIFF_TOKENS = 60_000;

type ResolvedComparisonBaseRef = {
  baseBranch: string;
  comparisonRef: string;
  source: 'remote' | 'local';
};

type ProviderReviewer = {
  reviewerId: number;
  model: ReviewSetupConfig['reviewers'][number];
};

type ProviderQueueResult = {
  providerId: string;
  reviews: IndividualReview[];
  failures: Array<{
    reviewerId: number;
    error: unknown;
  }>;
};

function parseFiles(output: string): string[] {
  return output.trim().split('\n').filter(Boolean);
}

function getModelProviderId(modelConfig: ProviderReviewer['model']): string {
  const model = modelConfig.model;
  if (typeof model === 'string') {
    return 'unknown';
  }
  return model.provider;
}

function isValidConcurrencyLimit(value: number): boolean {
  return (
    value === Number.POSITIVE_INFINITY || (Number.isInteger(value) && value > 0)
  );
}

function validateConcurrencyPerProvider(
  concurrencyPerProvider: ReviewConcurrencyConfig | undefined,
): void {
  if (concurrencyPerProvider === undefined) {
    return;
  }

  if (typeof concurrencyPerProvider === 'number') {
    if (!isValidConcurrencyLimit(concurrencyPerProvider)) {
      showErrorAndExit(
        `Invalid codeReview.concurrencyPerProvider value: ${concurrencyPerProvider}. Use a positive integer or Number.POSITIVE_INFINITY.`,
      );
    }
    return;
  }

  for (const [providerId, limit] of Object.entries(concurrencyPerProvider)) {
    if (!isValidConcurrencyLimit(limit)) {
      showErrorAndExit(
        `Invalid codeReview.concurrencyPerProvider["${providerId}"] value: ${limit}. Use a positive integer or Number.POSITIVE_INFINITY.`,
      );
    }
  }
}

function resolveProviderConcurrency(
  concurrencyPerProvider: ReviewConcurrencyConfig | undefined,
  providerId: string,
): number {
  if (concurrencyPerProvider === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  if (typeof concurrencyPerProvider === 'number') {
    return concurrencyPerProvider;
  }

  return concurrencyPerProvider[providerId] ?? Number.POSITIVE_INFINITY;
}

function formatConcurrencyLimit(limit: number): string {
  return limit === Number.POSITIVE_INFINITY ? '∞' : String(limit);
}

async function writeReviewFile(outputFilePath: string, content: string) {
  await mkdir(dirname(outputFilePath), { recursive: true });
  await writeFile(outputFilePath, content);
}

function getScopeDiffSource(scopeConfig: ScopeConfig): 'branch' | 'staged' {
  return scopeConfig.diffSource ?? 'branch';
}

async function fetchStagedFiles(): Promise<string[]> {
  const output = await runCmdSilentUnwrap([
    'git',
    'diff',
    '--cached',
    '--name-only',
  ]);
  return parseFiles(output);
}

async function fetchChangedFilesAgainstRef(ref: string): Promise<string[]> {
  const output = await runCmdSilentUnwrap([
    'git',
    'diff',
    '--name-only',
    `${ref}...HEAD`,
  ]);
  return parseFiles(output);
}

async function refExists(ref: string): Promise<boolean> {
  const result = await runCmdSilent([
    'git',
    'rev-parse',
    '--verify',
    '--quiet',
    ref,
  ]);

  return !result.error;
}

async function resolveComparisonBaseRef(
  baseBranch: string,
): Promise<ResolvedComparisonBaseRef> {
  const remoteRef = `origin/${baseBranch}`;

  const fetchResult = await runCmdSilent([
    'git',
    'fetch',
    'origin',
    baseBranch,
  ]);

  if (fetchResult.error) {
    console.warn(
      `⚠️ Could not fetch origin/${baseBranch}. Falling back to local refs if needed.`,
    );
  }

  if (await refExists(remoteRef)) {
    console.log(`📌 Using remote comparison ref: ${remoteRef}`);
    return {
      baseBranch,
      comparisonRef: remoteRef,
      source: 'remote',
    };
  }

  if (await refExists(baseBranch)) {
    console.log(`📌 Using local comparison ref: ${baseBranch}`);
    return {
      baseBranch,
      comparisonRef: baseBranch,
      source: 'local',
    };
  }

  showErrorAndExit(
    `Could not resolve base branch "${baseBranch}" as either "${remoteRef}" or local "${baseBranch}"`,
  );
}

async function resolveBaseBranchForReview(
  currentBranch: string,
  configuredBaseBranch:
    | string
    | ((currentBranch: string) => string)
    | undefined,
  argBaseBranch: string | undefined,
): Promise<string> {
  const fromArgs =
    argBaseBranch ?? resolveBaseBranch(configuredBaseBranch, currentBranch);
  if (fromArgs) return fromArgs;

  const branches = await git.getLocalBranches();
  const otherBranches = branches.filter((b) => b !== currentBranch);

  if (otherBranches.length === 0) {
    showErrorAndExit('No other branches found to compare against');
  }

  return cliInput.select('Select the base branch', {
    options: otherBranches.map((branch) => ({
      value: branch,
      label: branch,
    })),
  });
}

async function loadScopeContext(params: {
  scopeConfig: ScopeConfig;
  comparisonRef: string | null;
}): Promise<ScopeContext> {
  const { scopeConfig, comparisonRef } = params;
  const diffSource = getScopeDiffSource(scopeConfig);

  if (diffSource === 'staged') {
    const stagedFiles = await fetchStagedFiles();
    return {
      stagedFiles,
      allFiles: stagedFiles,
    };
  }

  if (!comparisonRef) {
    throw new Error('Comparison ref is required for branch-based scopes');
  }

  const [stagedFiles, allFiles] = await Promise.all([
    fetchStagedFiles(),
    fetchChangedFilesAgainstRef(comparisonRef),
  ]);

  return { stagedFiles, allFiles };
}

export type LocalReviewCommandId =
  | 'advanced-review-changes'
  | 'review-code-changes';

export type LocalReviewInstructionSelection = {
  includeDefaultReviewInstructions?: boolean;
  customReviewInstruction?: string;
};

type RunLocalReviewChangesWorkflowOptions = {
  setup?: string;
  scope?: string;
  baseBranch?: string;
  output?: string;
  commandId: LocalReviewCommandId;
  resolveInstructionSelection?: () => Promise<LocalReviewInstructionSelection>;
};

export async function runLocalReviewChangesWorkflow(
  options: RunLocalReviewChangesWorkflowOptions,
): Promise<void> {
  const {
    setup,
    scope,
    baseBranch,
    output,
    commandId,
    resolveInstructionSelection,
  } = options;
  const runStartedAt = new Date();
  const rootConfig = await loadConfig();
  const config = rootConfig.codeReview ?? {};
  validateConcurrencyPerProvider(config.concurrencyPerProvider);
  const outputFile = output ?? config.reviewOutputPath ?? 'pr-review.md';
  const logsDir = resolveLogsDir(config);

  let setupConfig: ReviewSetupConfig | undefined = resolveSetup(config, setup);
  let setupLabel = setup;

  if (setup && !setupConfig) {
    const availableSetups = getAvailableSetups(config);
    showErrorAndExit(
      `Invalid setup: ${setup}. Valid options: ${availableSetups.join(', ')}`,
    );
  }

  if (!setupConfig) {
    const setupsToUse = config.setup ?? BUILT_IN_SETUP_OPTIONS;
    const setupOptions = setupConfigsToOptions(setupsToUse);

    const selectedSetup = await cliInput.select('Select the review setup', {
      options: setupOptions,
    });

    setupLabel = selectedSetup;
    setupConfig = resolveSetup(config, selectedSetup);

    if (!setupConfig) {
      showErrorAndExit(`Failed to resolve setup: ${selectedSetup}`);
    }
  }

  let scopeConfig: ScopeConfig | undefined = resolveScope(config, scope);
  let scopeLabel = scope;

  if (scope && !scopeConfig) {
    const availableScopes = getAvailableScopes(config);
    showErrorAndExit(
      `Invalid scope: ${scope}. Valid options: ${availableScopes.join(', ')}`,
    );
  }

  if (!scopeConfig) {
    const scopesToUse = config.scope ?? BUILT_IN_SCOPE_OPTIONS;
    const scopeOptions = scopeConfigsToOptions(scopesToUse);
    const selectedScope = await cliInput.select('Select the review scope', {
      options: scopeOptions,
    });
    scopeLabel = selectedScope;
    scopeConfig = resolveScope(config, selectedScope);

    if (!scopeConfig) {
      showErrorAndExit(`Failed to resolve scope: ${selectedScope}`);
    }
  }

  const instructionSelection = await resolveInstructionSelection?.();
  const customReviewInstruction =
    instructionSelection?.customReviewInstruction?.trim() || undefined;
  const includeDefaultReviewInstructions =
    instructionSelection?.includeDefaultReviewInstructions;

  const currentBranch = git.getCurrentBranch();
  const diffSource = getScopeDiffSource(scopeConfig);
  const useStaged = diffSource === 'staged';

  let comparisonBaseRef: ResolvedComparisonBaseRef | null = null;
  if (!useStaged) {
    const selectedBaseBranch = await resolveBaseBranchForReview(
      currentBranch,
      config.baseBranch,
      baseBranch,
    );
    comparisonBaseRef = await resolveComparisonBaseRef(selectedBaseBranch);
  }

  console.log('\n🔄 Fetching file lists...');
  let scopeContext: ScopeContext;
  try {
    scopeContext = await loadScopeContext({
      scopeConfig,
      comparisonRef: comparisonBaseRef?.comparisonRef ?? null,
    });
  } catch (error) {
    showErrorAndExit(
      `Failed to load scope context for "${scopeConfig.id}": ${String(error)}`,
    );
  }

  let scopeFiles: string[];
  try {
    scopeFiles = await scopeConfig.getFiles(scopeContext);
  } catch (error) {
    showErrorAndExit(
      `Failed to resolve files for scope "${scopeConfig.id}": ${String(error)}`,
    );
  }

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
    useStaged ? 'staged changes' : (
      `${currentBranch} vs ${comparisonBaseRef?.comparisonRef ?? 'unknown'}`
    );

  console.log(`\n🔄 Processing ${sourceDescription}...`);
  if (comparisonBaseRef?.source === 'local') {
    console.log(
      `⚠️ Running against local base branch "${comparisonBaseRef.baseBranch}" because remote ref was unavailable.`,
    );
  }

  console.log(
    `📋 Using ${setupLabel} setup with ${setupConfig.reviewers.length} reviewer(s)\n`,
  );

  const prDiff = await getDiffForFiles(changedFiles, {
    baseBranch: comparisonBaseRef?.comparisonRef ?? currentBranch,
    excludeFiles: excludePatterns,
    useStaged,
  });

  const context: LocalReviewContext = {
    type: 'local',
    additionalInstructions: customReviewInstruction,
  };

  if (!prDiff.trim()) {
    console.log(
      'ℹ️ No reviewable code changes found after filtering import/export-only changes.',
    );
    const skippedUsage = createZeroTokenUsage('validator-skipped');
    const reviewContent = await formatValidatedReview(
      {
        summary:
          'No reviewable code changes found after filtering import/export-only changes.',
        issues: [],
        usage: skippedUsage,
      },
      'local',
      context,
      currentBranch,
      {
        reviews: [],
        validatorUsage: skippedUsage,
      },
    );
    await writeReviewFile(outputFile, reviewContent);
    await handleOutput(context, reviewContent, outputFile);
    return;
  }

  const diffTokens = estimateTokenCount(prDiff);

  if (diffTokens > MAX_DIFF_TOKENS) {
    console.log(
      `⚠️  Diff has ${formatNum(diffTokens)} tokens (max suggested: ${formatNum(MAX_DIFF_TOKENS)})`,
    );

    const shouldContinue = await cliInput.confirm(
      'Continue anyway? Large diffs may result in less accurate reviews',
      {
        initial: false,
      },
    );

    if (!shouldContinue) {
      process.exit(1);
    }
  }

  console.log(
    `🔍 Running ${setupConfig.reviewers.length} independent reviews...`,
  );

  const reviewersByProvider = new Map<string, ProviderReviewer[]>();
  for (const [index, model] of setupConfig.reviewers.entries()) {
    const reviewerId = index + 1;
    const providerId = getModelProviderId(model);

    const providerReviewers = reviewersByProvider.get(providerId);
    if (providerReviewers) {
      providerReviewers.push({ reviewerId, model });
    } else {
      reviewersByProvider.set(providerId, [{ reviewerId, model }]);
    }
  }

  console.log(`📊 Running queues for ${reviewersByProvider.size} provider(s)`);

  const providerQueuePromises: Promise<ProviderQueueResult>[] = [];
  for (const [providerId, providerReviewers] of reviewersByProvider) {
    const providerConcurrency = resolveProviderConcurrency(
      config.concurrencyPerProvider,
      providerId,
    );
    console.log(
      `🔄 Provider "${providerId}": ${providerReviewers.length} reviewer(s), concurrency ${formatConcurrencyLimit(providerConcurrency)}`,
    );

    const queue = createAsyncQueueWithMeta<
      IndividualReview,
      { reviewerId: number; providerId: string }
    >({ concurrency: providerConcurrency });

    for (const reviewer of providerReviewers) {
      void queue.resultifyAdd(
        () =>
          runSingleReview(
            context,
            null,
            changedFiles,
            prDiff,
            reviewer.reviewerId,
            reviewer.model,
            {
              reviewInstructionsPath: config.reviewInstructionsPath,
              includeAgentsFileInReviewPrompt:
                config.includeAgentsFileInReviewPrompt,
              includeDefaultReviewInstructions,
              customReviewInstruction,
            },
          ),
        {
          meta: { reviewerId: reviewer.reviewerId, providerId },
        },
      );
    }

    providerQueuePromises.push(
      queue.onIdle().then(() => ({
        providerId,
        reviews: queue.completions.map((completion) => completion.value),
        failures: queue.failures.map((failure) => ({
          reviewerId: failure.meta.reviewerId,
          error: failure.error,
        })),
      })),
    );
  }

  const successfulReviews: IndividualReview[] = [];
  const queueResults = await Promise.allSettled(providerQueuePromises);

  for (const queueResult of queueResults) {
    if (queueResult.status !== 'fulfilled') {
      console.error('Provider queue failed:', queueResult.reason);
      continue;
    }

    successfulReviews.push(...queueResult.value.reviews);
    for (const failure of queueResult.value.failures) {
      console.error(
        `Review ${failure.reviewerId} failed on provider "${queueResult.value.providerId}":`,
        failure.error,
      );
    }
  }

  successfulReviews.sort((a, b) => {
    const aId =
      typeof a.reviewerId === 'number' ?
        a.reviewerId
      : Number.POSITIVE_INFINITY;
    const bId =
      typeof b.reviewerId === 'number' ?
        b.reviewerId
      : Number.POSITIVE_INFINITY;
    if (aId !== bId) {
      return aId - bId;
    }
    return String(a.reviewerId).localeCompare(String(b.reviewerId));
  });

  if (successfulReviews.length === 0) {
    showErrorAndExit('All reviewers failed - cannot proceed with review');
  }

  console.log('\n🔍 Running validator to consolidate findings...');
  const validatedReview = await reviewValidator(
    context,
    successfulReviews,
    null,
    changedFiles,
    prDiff,
    undefined,
    setupConfig.validator,
    {
      reviewInstructionsPath: config.reviewInstructionsPath,
      includeDefaultReviewInstructions,
      customReviewInstruction,
    },
  );
  console.log(
    `✅ Validation complete - found ${validatedReview.issues.length} validated issues`,
  );
  logValidatedIssueSummary(validatedReview);

  const reviewsUsage = calculateReviewsUsage(successfulReviews);
  const totalUsage = calculateTotalUsage([
    ...successfulReviews.map((review) => review.usage),
    validatedReview.usage,
  ]);

  logTokenUsageBreakdown(reviewsUsage, validatedReview.usage);

  console.log(
    dedent`
      📊 Tokens:
        Total: ${formatNum(totalUsage.totalTokens || 0)}
        Input: ${formatNum(totalUsage.promptTokens || 0)}
        Output: ${formatNum(totalUsage.completionTokens || 0)}
        Reasoning: ${formatNum(totalUsage.reasoningTokens || 0)}
    `,
  );

  console.log('📝 Formatting review...');
  const reviewContent = await formatValidatedReview(
    validatedReview,
    'local',
    context,
    currentBranch,
    {
      reviews: successfulReviews,
      validatorUsage: validatedReview.usage,
    },
  );

  if (logsDir) {
    const runLogsPath = await persistReviewRunLogs({
      logsDir,
      command: commandId,
      context,
      setupId: setupLabel ?? setupConfig.reviewers.length.toString(),
      scopeId: scopeConfig.id,
      branchName: currentBranch,
      runStartedAt,
      runEndedAt: new Date(),
      changedFiles,
      prDiff,
      reviews: successfulReviews,
      validatedReview,
      finalReviewMarkdown: reviewContent,
      outputFilePath: outputFile,
    });
    console.log(`🗂️ Review logs saved to ${runLogsPath}`);
  }

  await writeReviewFile(outputFile, reviewContent);
  await handleOutput(context, reviewContent, outputFile);
}

export const reviewCodeChangesCommand = createCmd({
  description: 'Review local code changes with AI',
  short: 'rc',
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
  },
  examples: [
    { args: ['--scope', 'staged'], description: 'Review staged changes' },
    { args: ['--scope', 'all'], description: 'Review all changes vs base' },
    { args: ['--setup', 'light'], description: 'Use light review setup' },
    {
      args: ['--scope', 'all', '--output', 'reviews/local-review.md'],
      description: 'Save the review to a custom file path',
    },
  ],
  run: async ({ setup, scope, baseBranch, output }) => {
    await runLocalReviewChangesWorkflow({
      setup,
      scope,
      baseBranch,
      output,
      commandId: 'review-code-changes',
    });
  },
});
