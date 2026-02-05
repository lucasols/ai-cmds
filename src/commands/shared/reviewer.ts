import { generateText, generateObject, stepCountIs } from 'ai';
import { z } from 'zod';
import { dedent } from '@ls-stack/utils/dedent';
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
  IndividualReview,
  ValidatedReview,
  GeneralPRComment,
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

export async function runSingleReview(
  context: ReviewContext,
  prData: PRData | null,
  changedFiles: string[],
  prDiff: string,
  reviewerId: number,
  { model, config }: Model,
  reviewInstructionsPath?: string,
): Promise<IndividualReview> {
  const initialPrompt = createReviewPrompt(
    context,
    prData,
    changedFiles,
    prDiff,
    reviewInstructionsPath,
  );

  const result = await resultify(
    generateText({
      model,
      system: initialPrompt.system,
      prompt: initialPrompt.prompt,
      maxOutputTokens: 200_000,
      stopWhen: stepCountIs(100),
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
  };
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
          line: z
            .number()
            .nullable()
            .describe('The specific line number of the code (if any)'),
        }),
      ),
      description: z.string(),
      currentCode: z
        .string()
        .nullable()
        .describe(
          "The current code (if any), also preserve the code indentation or add it if it's not present",
        ),
      suggestedFix: z
        .string()
        .nullable()
        .describe(
          "The suggested fix as a markdown string (if any). Should contain properly formatted code blocks with language identifiers (e.g. ```typescript ... ``` or ```diff ... ```). Preserve the code indentation or add it if it's not present.",
        ),
    }),
  ),
  summary: z.string(),
});

export async function reviewValidator(
  context: ReviewContext,
  reviews: IndividualReview[],
  prData: PRData | null,
  changedFiles: string[],
  prDiff: string,
  humanComments: GeneralPRComment[] | undefined,
  { model, config }: Model,
  formatter: Model,
  reviewInstructionsPath?: string,
): Promise<ValidatedReview> {
  const feedbackPrompt = createValidationPrompt(
    context,
    reviews,
    prData,
    changedFiles,
    prDiff,
    humanComments,
    reviewInstructionsPath,
  );

  const result = await generateText({
    model,
    system: feedbackPrompt.system,
    prompt: feedbackPrompt.prompt,
    maxOutputTokens: 100_000,
    stopWhen: stepCountIs(100),
    tools: {
      readFile: createReadFileTool(),
      listDirectory: createListDirectoryTool(),
      ripgrep: createRipgrepTool(),
    },
    ...(config?.topP !== false && { topP: config?.topP ?? 0.7 }),
    providerOptions:
      config?.providerOptions ?
        { [getProviderId(model)]: config.providerOptions }
      : undefined,
  });

  const formattedResult = await generateObject({
    model: formatter.model,
    system: dedent`
      Extract the validated PR review content into the JSON structure defined by the schema.
      For the current/suggestedCode, preserve the code indentation or add it if it's not present so the code is properly formatted and readable.
      If the input uses a diff format, don't change it to a language specific code block, keep the diff format.

      INDENTATION: Preserve code indentation or fix it if flattened. Use 2 spaces for indentation.
      NEVER produce flattened code such as:

      \`\`\`typescript
      function example() {
      return {
      name: 'example',
      age: 20,
      };
      }
      \`\`\`

      or diff such as:

      \`\`\`diff
      function example() {
      return {
      name: 'example',
      age: 20,
      };

      +function example() {
      +return {
      +name: 'example',
      +age: 20,
      +};
      +}
      \`\`\`

      Instead, produce the code or diff with the proper indentation:

      \`\`\`typescript
      function example() {
        return {
          name: 'example',
          age: 20,
        };
      }
      \`\`\`

      or a diff with the proper indentation:

      \`\`\`diff
        function example() {
          return {
            name: 'example',
            age: 20,
          };
        }

      + function example() {
      +   return {
      +     name: 'example',
      +     age: 20,
      +   };
      + }
      \`\`\`
    `,
    prompt: result.text,
    schema: validatedReviewSchema,
    providerOptions: {
      openai: { structuredOutputs: true, strictJsonSchema: true },
    },
  });

  const reviewUsage = result.usage;
  const formatUsage = formattedResult.usage;

  return {
    issues: formattedResult.object.issues,
    summary: formattedResult.object.summary,
    usage: {
      promptTokens: reviewUsage.inputTokens ?? 0,
      completionTokens: reviewUsage.outputTokens ?? 0,
      totalTokens: reviewUsage.totalTokens ?? 0,
      reasoningTokens: reviewUsage.reasoningTokens ?? 0,
      model: getModelId(model),
    },
    formatterUsage: {
      promptTokens: formatUsage.inputTokens ?? 0,
      completionTokens: formatUsage.outputTokens ?? 0,
      totalTokens: formatUsage.totalTokens ?? 0,
      reasoningTokens: formatUsage.reasoningTokens ?? 0,
      model: getModelId(formatter.model),
    },
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
      maxOutputTokens: 100_000,
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

  console.log(`✅ Previous review check completed with model ${modelId}`);

  return {
    reviewerId: 'previous-review-checker',
    content: result.value.text,
    usage: {
      promptTokens: result.value.usage.inputTokens ?? 0,
      completionTokens: result.value.usage.outputTokens ?? 0,
      totalTokens: result.value.usage.totalTokens ?? 0,
      reasoningTokens: result.value.usage.reasoningTokens,
      model: modelId,
    },
  };
}
