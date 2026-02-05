import { generateText, Output, stepCountIs } from 'ai';
import { z } from 'zod';
import { resultify } from 't-result';
import {
  createReadFileTool,
  createListDirectoryTool,
  createRipgrepTool,
} from '../../lib/ai-tools.ts';
import {
  createReviewPrompt,
  createValidationPrompt,
  createPreviousReviewCheckPrompt,
} from './prompts.ts';
import { github } from '../../lib/github.ts';
import { EXTRA_DETAILS_MARKER, PR_REVIEW_MARKER } from './output.ts';
import type {
  Model,
  ReviewContext,
  PRReviewContext,
  PRData,
  LLMDebugTrace,
  IndividualReview,
  ValidatedReview,
  GeneralPRComment,
  ReviewIssue,
} from './types.ts';

function getModelId(model: Model['model']): string {
  if (typeof model === 'string') {
    return model;
  }
  return model.modelId;
}

function getProviderId(model: Model['model']): string {
  if (typeof model === 'string') {
    return 'unknown';
  }
  return model.provider;
}

const validatedReviewSchema = z.object({
  issues: z.array(
    z.object({
      category: z.enum([
        'critical',
        'possible',
        'suggestion',
        'not-applicable-or-false-positive',
      ]),
      files: z.array(
        z.object({
          path: z.string(),
          line: z.number().int().positive().nullable(),
        }),
      ),
      description: z.string(),
      currentCode: z.string().nullable(),
      suggestedFix: z.string().nullable(),
    }),
  ),
  summary: z.string(),
});

function normalizeValidatedIssues(
  issues: z.infer<typeof validatedReviewSchema.shape.issues>,
): ReviewIssue[] {
  return issues
    .filter((issue) => issue.category !== 'not-applicable-or-false-positive')
    .map((issue) => ({
      ...issue,
      currentCode: issue.currentCode ?? null,
      suggestedFix: issue.suggestedFix ?? null,
    }));
}

function createDebugTrace(params: {
  startedAt: Date;
  endedAt: Date;
  model: Model['model'];
  config: Model['config'] | undefined;
  result: {
    text: string;
    finishReason: unknown;
    steps: unknown;
    response: unknown;
    warnings: unknown;
    request: unknown;
    providerMetadata: unknown;
    experimentalOutput: unknown;
  };
}): LLMDebugTrace {
  const { startedAt, endedAt, model, config, result } = params;
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    model: {
      id: getModelId(model),
      provider: getProviderId(model),
    },
    config,
    result,
  };
}

export async function runSingleReview(
  context: ReviewContext,
  prData: PRData | null,
  changedFiles: string[],
  prDiff: string,
  reviewerId: number,
  { model, config }: Model,
  reviewInstructionsPath?: string,
  includeAgentsFileInReviewPrompt?: boolean,
): Promise<IndividualReview> {
  const startedAt = new Date();
  const initialPrompt = createReviewPrompt(
    context,
    prData,
    changedFiles,
    prDiff,
    reviewInstructionsPath,
    includeAgentsFileInReviewPrompt,
  );

  const result = await resultify(
    generateText({
      model,
      system: initialPrompt.system,
      prompt: initialPrompt.prompt,
      maxOutputTokens: 60_000,
      stopWhen: stepCountIs(80),
      maxRetries: 3,
      tools: {
        readFile: createReadFileTool(reviewerId),
        listDirectory: createListDirectoryTool(reviewerId),
        ripgrep: createRipgrepTool(reviewerId),
      },
      ...(config?.topP !== false && { topP: config?.topP ?? 0.9 }),
      providerOptions:
        config?.providerOptions ?
          { [getProviderId(model)]: config.providerOptions }
        : undefined,
    }),
  );

  const modelId = getModelId(model);

  if (result.error) {
    console.error(
      `❌ Review ${reviewerId} failed with model ${modelId}`,
      result.error,
    );
    throw result.error;
  }

  console.log(
    `✅ Review ${reviewerId} completed successfully with model ${modelId}`,
  );
  const endedAt = new Date();

  return {
    reviewerId,
    content: result.value.text,
    usage: {
      promptTokens: result.value.usage.inputTokens ?? 0,
      completionTokens: result.value.usage.outputTokens ?? 0,
      totalTokens: result.value.usage.totalTokens ?? 0,
      reasoningTokens: result.value.usage.reasoningTokens,
      model: modelId,
    },
    debug: createDebugTrace({
      startedAt,
      endedAt,
      model,
      config,
      result: {
        text: result.value.text,
        finishReason: result.value.finishReason,
        steps: result.value.steps,
        response: result.value.response,
        warnings: result.value.warnings,
        request: result.value.request,
        providerMetadata: result.value.providerMetadata,
        experimentalOutput: null,
      },
    }),
  };
}

export async function reviewValidator(
  context: ReviewContext,
  reviews: IndividualReview[],
  prData: PRData | null,
  changedFiles: string[],
  prDiff: string,
  humanComments: GeneralPRComment[] | undefined,
  { model, config }: Model,
  reviewInstructionsPath?: string,
): Promise<ValidatedReview> {
  const startedAt = new Date();
  const feedbackPrompt = createValidationPrompt(
    context,
    reviews,
    prData,
    changedFiles,
    prDiff,
    humanComments,
    reviewInstructionsPath,
  );

  const result = await resultify(
    generateText({
      model,
      system: feedbackPrompt.system,
      prompt: feedbackPrompt.prompt,
      maxOutputTokens: 80_000,
      stopWhen: stepCountIs(80),
      maxRetries: 3,
      tools: {
        readFile: createReadFileTool(),
        listDirectory: createListDirectoryTool(),
        ripgrep: createRipgrepTool(),
      },
      experimental_output: Output.object({ schema: validatedReviewSchema }),
      ...(config?.topP !== false && { topP: config?.topP ?? 0.7 }),
      providerOptions:
        config?.providerOptions ?
          { [getProviderId(model)]: config.providerOptions }
        : undefined,
    }),
  );

  if (result.error) {
    console.error(
      `❌ Validator failed with model ${getModelId(model)}`,
      result.error,
    );
    throw result.error;
  }

  const validatedOutput = result.value.experimental_output;
  const validatedIssues = normalizeValidatedIssues(validatedOutput.issues);
  const endedAt = new Date();

  return {
    issues: validatedIssues,
    summary: validatedOutput.summary,
    usage: {
      promptTokens: result.value.usage.inputTokens ?? 0,
      completionTokens: result.value.usage.outputTokens ?? 0,
      totalTokens: result.value.usage.totalTokens ?? 0,
      reasoningTokens: result.value.usage.reasoningTokens ?? 0,
      model: getModelId(model),
    },
    debug: createDebugTrace({
      startedAt,
      endedAt,
      model,
      config,
      result: {
        text: result.value.text,
        finishReason: result.value.finishReason,
        steps: result.value.steps,
        response: result.value.response,
        warnings: result.value.warnings,
        request: result.value.request,
        providerMetadata: result.value.providerMetadata,
        experimentalOutput: validatedOutput,
      },
    }),
  };
}

export async function runPreviousReviewCheck(
  context: PRReviewContext,
  prData: PRData | null,
  changedFiles: string[],
  prDiff: string,
  { model, config }: Model,
  reviewInstructionsPath?: string,
): Promise<IndividualReview | null> {
  const startedAt = new Date();
  const previousReviewBody = await github.getLatestPRReviewComment(
    context.prNumber,
    PR_REVIEW_MARKER,
  );

  if (!previousReviewBody) {
    console.log('ℹ️ No previous review found for this PR');
    return null;
  }

  const previousIssues = github.parsePreviousReviewIssues(
    previousReviewBody,
    PR_REVIEW_MARKER,
    EXTRA_DETAILS_MARKER,
  );

  if (!previousIssues) {
    console.log('ℹ️ Could not parse issues from previous review');
    return null;
  }

  console.log('🔍 Checking if previous review issues are still present...');

  const prompt = createPreviousReviewCheckPrompt(
    context,
    prData,
    changedFiles,
    prDiff,
    previousIssues,
    reviewInstructionsPath,
  );

  const result = await resultify(
    generateText({
      model,
      system: prompt.system,
      prompt: prompt.prompt,
      maxOutputTokens: 40_000,
      stopWhen: stepCountIs(50),
      maxRetries: 3,
      tools: {
        readFile: createReadFileTool('previous-review-checker'),
        listDirectory: createListDirectoryTool('previous-review-checker'),
        ripgrep: createRipgrepTool('previous-review-checker'),
      },
      ...(config?.topP !== false && { topP: config?.topP ?? 0.7 }),
      providerOptions:
        config?.providerOptions ?
          { [getProviderId(model)]: config.providerOptions }
        : undefined,
    }),
  );

  const modelId = getModelId(model);

  if (result.error) {
    console.error(`❌ Previous review check failed with model ${modelId}`);
    return null;
  }

  const previousCheckContent = result.value.text;

  const normalizedPreviousCheckContent = previousCheckContent.toLowerCase();
  const hasNoUnresolvedIssues =
    normalizedPreviousCheckContent.includes('no issues found') ||
    normalizedPreviousCheckContent.includes(
      'no issues identified in this review',
    );

  if (hasNoUnresolvedIssues) {
    console.log('✅ Previous review check: no unresolved prior issues');
    return null;
  }

  console.log(
    `✅ Previous review check completed successfully with model ${modelId}`,
  );
  const endedAt = new Date();

  return {
    reviewerId: 'previous-review-checker',
    content: previousCheckContent,
    usage: {
      promptTokens: result.value.usage.inputTokens ?? 0,
      completionTokens: result.value.usage.outputTokens ?? 0,
      totalTokens: result.value.usage.totalTokens ?? 0,
      reasoningTokens: result.value.usage.reasoningTokens,
      model: modelId,
    },
    debug: createDebugTrace({
      startedAt,
      endedAt,
      model,
      config,
      result: {
        text: result.value.text,
        finishReason: result.value.finishReason,
        steps: result.value.steps,
        response: result.value.response,
        warnings: result.value.warnings,
        request: result.value.request,
        providerMetadata: result.value.providerMetadata,
        experimentalOutput: null,
      },
    }),
  };
}
