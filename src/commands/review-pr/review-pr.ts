import { createCmd } from '@ls-stack/cli';
import { createAsyncQueueWithMeta } from '@ls-stack/utils/asyncQueue';
import { dedent } from '@ls-stack/utils/dedent';
import { writeFile } from 'fs/promises';
import { estimateTokenCount } from 'tokenx';
import {
  getExcludePatterns,
  loadConfig,
  type ReviewConcurrencyConfig,
  resolveLogsDir,
} from '../../lib/config.ts';
import { formatNum } from '../../lib/diff.ts';
import { github } from '../../lib/github.ts';
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
import {
  reviewValidator,
  runPreviousReviewCheck,
  runSingleReview,
} from '../shared/reviewer.ts';
import { persistReviewRunLogs } from '../shared/review-logs.ts';
import {
  getAvailableSetups,
  resolveSetup,
  reviewSetupConfigs,
  type ReviewSetupConfig,
} from '../shared/setups.ts';
import type { IndividualReview, PRReviewContext } from '../shared/types.ts';

const MAX_DIFF_TOKENS = 60_000;

type ProviderReviewTask = {
  reviewerId: IndividualReview['reviewerId'];
  model: ReviewSetupConfig['reviewers'][number];
};

type ProviderQueueResult = {
  providerId: string;
  reviews: IndividualReview[];
  failures: Array<{
    reviewerId: IndividualReview['reviewerId'];
    error: unknown;
  }>;
};

function getModelProviderId(modelConfig: ProviderReviewTask['model']): string {
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

function reviewerSortOrder(reviewerId: IndividualReview['reviewerId']): number {
  if (reviewerId === 'previous-review-checker') {
    return 0;
  }
  return reviewerId + 1;
}

export const reviewPRCommand = createCmd({
  description: 'Review a GitHub PR with AI',
  short: 'rp',
  args: {
    pr: {
      type: 'value-string-flag',
      name: 'pr',
      description: 'PR number to review (required)',
    },
    setup: {
      type: 'value-string-flag',
      name: 'setup',
      description: 'Review setup (light, medium, heavy)',
    },
    test: {
      type: 'flag',
      name: 'test',
      description: 'Test mode - skip posting to PR',
    },
    skipPreviousCheck: {
      type: 'flag',
      name: 'skip-previous-check',
      description: 'Skip checking if previous review issues are still present',
    },
  },
  examples: [
    { args: ['--pr', '123'], description: 'Review PR #123' },
    {
      args: ['--pr', '123', '--test'],
      description: 'Review PR #123 without posting',
    },
    {
      args: ['--pr', '123', '--setup', 'heavy'],
      description: 'Heavy review of PR #123',
    },
  ],
  run: async ({ pr, setup, test, skipPreviousCheck }) => {
    const runStartedAt = new Date();
    if (!pr) {
      showErrorAndExit('PR number is required. Use --pr <number>');
    }

    const rootConfig = await loadConfig();
    const config = rootConfig.codeReview ?? {};
    validateConcurrencyPerProvider(config.concurrencyPerProvider);
    const logsDir = resolveLogsDir(config);

    const isGitHubActions = Boolean(process.env.GITHUB_ACTIONS);

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
      setupLabel = 'light';
      setupConfig = reviewSetupConfigs.light;
    }

    console.log(`\n🔄 Fetching PR #${pr} data...`);

    const [prData, prFiles] = await Promise.all([
      github.getPRData(pr),
      github.getChangedFiles(pr),
    ]);

    console.log(`📋 PR: "${prData.title}" by @${prData.author.login}`);
    console.log(`📁 ${prFiles.length} files changed`);

    const excludePatterns = getExcludePatterns(config);
    const changedFiles = applyExcludePatterns(prFiles, excludePatterns);

    if (changedFiles.length === 0) {
      showErrorAndExit(
        `No files to review in PR #${pr}${excludePatterns ? ' after applying exclude patterns' : ''}`,
      );
    }

    if (excludePatterns && prFiles.length !== changedFiles.length) {
      const excludedCount = prFiles.length - changedFiles.length;
      console.log(
        `📂 Reviewing ${changedFiles.length} files (${excludedCount} files filtered out)`,
      );
    }

    console.log(
      `📋 Using ${setupLabel} setup with ${setupConfig.reviewers.length} reviewer(s)\n`,
    );

    const prDiff = await getDiffForFiles(changedFiles, {
      baseBranch: prData.baseRefName,
      excludeFiles: excludePatterns,
      useStaged: false,
    });

    const mode: 'gh-actions' | 'test' =
      isGitHubActions && !test ? 'gh-actions' : 'test';

    const context: PRReviewContext = {
      type: 'pr',
      prNumber: pr,
      mode,
      additionalInstructions: undefined,
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
        prData.author.login,
        context,
        prData.headRefName,
        {
          reviews: [],
          validatorUsage: skippedUsage,
        },
      );
      const outputFile = mode === 'test' ? 'pr-review-test.md' : 'pr-review.md';
      await writeFile(outputFile, reviewContent);
      await handleOutput(context, reviewContent, outputFile);
      return;
    }

    const diffTokens = estimateTokenCount(prDiff);

    if (diffTokens > MAX_DIFF_TOKENS) {
      showErrorAndExit(
        `❌ PR has ${formatNum(diffTokens)} tokens in the diff (max allowed: ${formatNum(MAX_DIFF_TOKENS)})`,
      );
    }

    const shouldRunPreviousCheck = !skipPreviousCheck && mode === 'gh-actions';

    const totalReviewers =
      setupConfig.reviewers.length + (shouldRunPreviousCheck ? 1 : 0);
    console.log(`🔍 Running ${totalReviewers} independent reviews...`);

    const reviewersByProvider = new Map<string, ProviderReviewTask[]>();
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

    if (shouldRunPreviousCheck) {
      const previousCheckProviderId = getModelProviderId(setupConfig.validator);
      const providerReviewers = reviewersByProvider.get(
        previousCheckProviderId,
      );
      if (providerReviewers) {
        providerReviewers.push({
          reviewerId: 'previous-review-checker',
          model: setupConfig.validator,
        });
      } else {
        reviewersByProvider.set(previousCheckProviderId, [
          {
            reviewerId: 'previous-review-checker',
            model: setupConfig.validator,
          },
        ]);
      }
    }

    console.log(
      `📊 Running queues for ${reviewersByProvider.size} provider(s)`,
    );

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
        IndividualReview | null,
        { reviewerId: IndividualReview['reviewerId']; providerId: string }
      >({ concurrency: providerConcurrency });

      for (const reviewer of providerReviewers) {
        if (reviewer.reviewerId === 'previous-review-checker') {
          void queue.resultifyAdd(
            () =>
              runPreviousReviewCheck(
                context,
                prData,
                changedFiles,
                prDiff,
                reviewer.model,
                config.reviewInstructionsPath,
              ),
            {
              meta: { reviewerId: reviewer.reviewerId, providerId },
            },
          );
          continue;
        }

        const reviewerId = reviewer.reviewerId;

        void queue.resultifyAdd(
          () =>
            runSingleReview(
              context,
              prData,
              changedFiles,
              prDiff,
              reviewerId,
              reviewer.model,
              config.reviewInstructionsPath,
              config.includeAgentsFileInReviewPrompt,
            ),
          {
            meta: { reviewerId, providerId },
          },
        );
      }

      providerQueuePromises.push(
        queue.onIdle().then(() => ({
          providerId,
          reviews: queue.completions
            .map((completion) => completion.value)
            .filter((review): review is IndividualReview => review !== null),
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

    successfulReviews.sort(
      (a, b) =>
        reviewerSortOrder(a.reviewerId) - reviewerSortOrder(b.reviewerId),
    );

    if (successfulReviews.length === 0) {
      showErrorAndExit('All reviewers failed - cannot proceed with review');
    }

    console.log('\n📥 Fetching human review comments...');
    let humanComments;
    try {
      humanComments = await github.getAllHumanPRComments(pr);
      console.log(
        `📋 Found ${humanComments.length} general comments from humans`,
      );
    } catch (error) {
      console.warn('⚠️ Failed to fetch human comments:', error);
    }

    console.log('🔍 Running validator to consolidate findings...');
    const validatedReview = await reviewValidator(
      context,
      successfulReviews,
      prData,
      changedFiles,
      prDiff,
      humanComments,
      setupConfig.validator,
      config.reviewInstructionsPath,
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
      prData.author.login,
      context,
      prData.headRefName,
      {
        reviews: successfulReviews,
        validatorUsage: validatedReview.usage,
      },
    );

    const outputFile = mode === 'test' ? 'pr-review-test.md' : 'pr-review.md';
    await writeFile(outputFile, reviewContent);

    if (logsDir) {
      const runLogsPath = await persistReviewRunLogs({
        logsDir,
        command: 'review-pr',
        context,
        setupId: setupLabel ?? setupConfig.reviewers.length.toString(),
        branchName: prData.headRefName,
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

    await handleOutput(context, reviewContent, outputFile);
  },
});
