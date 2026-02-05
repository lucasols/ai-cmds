import { createCmd } from '@ls-stack/cli';
import { dedent } from '@ls-stack/utils/dedent';
import { writeFile } from 'fs/promises';
import { estimateTokenCount } from 'tokenx';
import { getExcludePatterns, loadConfig } from '../../lib/config.ts';
import { formatNum } from '../../lib/diff.ts';
import { github } from '../../lib/github.ts';
import { showErrorAndExit } from '../../lib/shell.ts';
import { applyExcludePatterns, getDiffForFiles } from '../shared/diff-utils.ts';
import {
  calculateReviewsUsage,
  calculateTotalUsage,
  formatValidatedReview,
  handleOutput,
  logTokenUsageBreakdown,
} from '../shared/output.ts';
import {
  reviewValidator,
  runSingleReview,
  runPreviousReviewCheck,
} from '../shared/reviewer.ts';
import {
  resolveSetup,
  reviewSetupConfigs,
  type ReviewSetupConfig,
} from '../shared/setups.ts';
import type { IndividualReview, PRReviewContext } from '../shared/types.ts';

const MAX_DIFF_TOKENS = 60_000;

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
    if (!pr) {
      showErrorAndExit('PR number is required. Use --pr <number>');
    }

    const rootConfig = await loadConfig();
    const config = rootConfig.reviewCodeChanges ?? {};

    const isGitHubActions = Boolean(process.env.GITHUB_ACTIONS);

    let setupConfig: ReviewSetupConfig | undefined = resolveSetup(
      config,
      setup,
    );
    let setupLabel = setup;

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

    const diffTokens = estimateTokenCount(prDiff);

    if (diffTokens > MAX_DIFF_TOKENS) {
      showErrorAndExit(
        `❌ PR has ${formatNum(diffTokens)} tokens in the diff (max allowed: ${formatNum(MAX_DIFF_TOKENS)})`,
      );
    }

    const mode: 'gh-actions' | 'test' =
      isGitHubActions && !test ? 'gh-actions' : 'test';

    const context: PRReviewContext = {
      type: 'pr',
      prNumber: pr,
      mode,
      additionalInstructions: undefined,
    };

    const shouldRunPreviousCheck = !skipPreviousCheck && mode === 'gh-actions';

    console.log(
      `🔍 Running ${setupConfig.reviewers.length} independent reviews...`,
    );

    const previousReviewPromise =
      shouldRunPreviousCheck ?
        runPreviousReviewCheck(
          context,
          prData,
          changedFiles,
          prDiff,
          setupConfig.validator,
          config.reviewInstructionsPath,
        )
      : Promise.resolve(null);

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

    const [previousReviewResult, ...reviewResults] = await Promise.allSettled([
      previousReviewPromise,
      ...reviewPromises,
    ]);

    const successfulReviews: IndividualReview[] = [];

    if (
      previousReviewResult.status === 'fulfilled' &&
      previousReviewResult.value !== null &&
      previousReviewResult.value.usage.totalTokens > 0 &&
      !previousReviewResult.value.content.trim().includes('No issues found')
    ) {
      successfulReviews.push(previousReviewResult.value);
    }

    for (const result of reviewResults) {
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

    console.log('📥 Fetching human review comments...');
    let humanComments;
    try {
      humanComments = await github.getAllHumanPRComments(pr);
      console.log(
        `📋 Found ${humanComments.length} general comments from humans`,
      );
    } catch (error) {
      console.warn('⚠️ Failed to fetch human comments:', error);
    }

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

    console.log('📝 Formatting review...');
    const reviewContent = await formatValidatedReview(
      validatedReview,
      prData.author.login,
      context,
      prData.headRefName,
      {
        reviews: successfulReviews,
        validatorUsage: validatedReview.usage,
        formatterUsage: validatedReview.formatterUsage,
      },
    );

    const outputFile = mode === 'test' ? 'pr-review-test.md' : 'pr-review.md';
    await writeFile(outputFile, reviewContent);

    await handleOutput(context, reviewContent);
  },
});
