import { yamlStringify } from '@ls-stack/utils/yamlStringify';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type {
  IndividualReview,
  ReviewContext,
  TokenUsage,
  ValidatedReview,
} from './types.ts';

type PersistReviewRunLogsParams = {
  logsDir: string;
  command: 'review-code-changes' | 'review-pr';
  context: ReviewContext;
  setupId: string;
  scopeId?: string;
  branchName?: string;
  runStartedAt: Date;
  runEndedAt?: Date;
  changedFiles: string[];
  prDiff: string;
  reviews: IndividualReview[];
  validatedReview: ValidatedReview;
  finalReviewMarkdown: string;
  outputFilePath: string;
};

function sanitizePathSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'unknown';
}

function formatTimestampForPath(date: Date): string {
  return date
    .toISOString()
    .replace('T', '_')
    .replace(/\..+$/, '')
    .replace(/:/g, '-');
}

function createRunFolderName(params: {
  branchName?: string;
  context: ReviewContext;
  startedAt: Date;
}): string {
  const fallbackBranch =
    params.context.type === 'pr' ?
      `pr-${params.context.prNumber}`
    : 'local-review';

  const branchSegment = sanitizePathSegment(
    params.branchName ?? fallbackBranch,
  );
  const timestampSegment = formatTimestampForPath(params.startedAt);
  const randomSegment = Math.random().toString(36).slice(2, 8);

  return `${branchSegment}-${timestampSegment}-${randomSegment}`;
}

async function writeYamlFile(path: string, data: unknown): Promise<void> {
  const yaml = yamlStringify(data, { maxDepth: 200, maxLineLength: 160 });
  await writeFile(path, `${yaml}\n`);
}

async function writeReviewerLogs(
  runDir: string,
  reviews: IndividualReview[],
): Promise<void> {
  const reviewersDir = join(runDir, 'reviewers');
  await mkdir(reviewersDir, { recursive: true });

  await Promise.all(
    reviews.flatMap((review) => [
      writeFile(
        join(reviewersDir, `reviewer-${review.reviewerId}.md`),
        review.content,
      ),
      writeYamlFile(
        join(reviewersDir, `reviewer-${review.reviewerId}-debug.yaml`),
        {
          reviewerId: review.reviewerId,
          usage: review.usage,
          debug: review.debug,
        },
      ),
    ]),
  );
}

function sumUsage(usages: TokenUsage[]): TokenUsage {
  const totals = usages.reduce(
    (acc, usage) => {
      acc.promptTokens += usage.promptTokens || 0;
      acc.completionTokens += usage.completionTokens || 0;
      acc.totalTokens += usage.totalTokens || 0;
      acc.reasoningTokens += usage.reasoningTokens ?? 0;
      return acc;
    },
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
    },
  );

  return {
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    totalTokens: totals.totalTokens,
    reasoningTokens: totals.reasoningTokens || undefined,
    model: 'total',
  };
}

export async function persistReviewRunLogs(
  params: PersistReviewRunLogsParams,
): Promise<string> {
  const endedAt = params.runEndedAt ?? new Date();
  const runFolderName = createRunFolderName({
    branchName: params.branchName,
    context: params.context,
    startedAt: params.runStartedAt,
  });
  const runDir = join(params.logsDir, params.command, runFolderName);

  await mkdir(runDir, { recursive: true });

  const reviewUsages = params.reviews.map((review) => review.usage);
  const totalUsage = sumUsage([...reviewUsages, params.validatedReview.usage]);

  await Promise.all([
    writeFile(
      join(runDir, 'changed-files.txt'),
      `${params.changedFiles.join('\n')}\n`,
    ),
    writeFile(join(runDir, 'diff.diff'), params.prDiff),
    writeFile(join(runDir, 'final-review.md'), params.finalReviewMarkdown),
    writeYamlFile(join(runDir, 'context.yaml'), {
      command: params.command,
      context: params.context,
      setupId: params.setupId,
      scopeId: params.scopeId ?? null,
      branchName: params.branchName ?? null,
      outputFilePath: params.outputFilePath,
      changedFilesCount: params.changedFiles.length,
      changedFiles: params.changedFiles,
      diffCharacterCount: params.prDiff.length,
      startedAt: params.runStartedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - params.runStartedAt.getTime(),
    }),
    writeYamlFile(join(runDir, 'validator.yaml'), {
      summary: params.validatedReview.summary,
      issues: params.validatedReview.issues,
      usage: params.validatedReview.usage,
      debug: params.validatedReview.debug,
    }),
    writeYamlFile(join(runDir, 'summary.yaml'), {
      startedAt: params.runStartedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - params.runStartedAt.getTime(),
      reviewsCount: params.reviews.length,
      validatedIssuesCount: params.validatedReview.issues.length,
      tokenUsage: {
        reviews: reviewUsages,
        validator: params.validatedReview.usage,
        total: totalUsage,
      },
    }),
    writeReviewerLogs(runDir, params.reviews),
  ]);

  return runDir;
}
