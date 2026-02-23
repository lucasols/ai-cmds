import { generateObject, type LanguageModel } from 'ai';
import { globalAbortSignal } from '../../lib/abort.ts';
import { estimateTokenCount, sliceByTokens } from 'tokenx';
import { z } from 'zod';
import type { CreatePRConfig, GeneratedPRContent } from './types.ts';

const DEFAULT_MAX_DIFF_TOKENS = 50000;

const prContentSchema = z.object({
  title: z
    .string()
    .describe(
      'Concise PR title (50-70 chars), imperative mood. Focus on user-facing impact.',
    ),
  summary: z
    .string()
    .describe('Brief summary of what this PR does and why. 1-3 sentences max.'),
  changes: z
    .array(z.string())
    .describe(
      'List of key changes. Each item should be a single, clear statement.',
    ),
  testingNotes: z
    .string()
    .describe(
      'Brief notes on how to test these changes, or key areas to verify.',
    ),
});

const systemPrompt = `You are a helpful assistant that generates clear, professional Pull Request titles and descriptions.

Guidelines for PR titles:
- Keep them concise (50-70 characters max)
- Use imperative mood ("Add feature" not "Added feature")
- Focus on what the PR does from a user/developer perspective
- Avoid generic words like "Update", "Fix", "Change" without context
- If it's a bug fix, briefly describe what was broken
- If it's a feature, describe the capability being added

Guidelines for summaries:
- Be concise (1-3 sentences)
- Explain the "what" and "why", not the "how"
- Highlight the user-facing impact when applicable

Guidelines for changes list:
- Keep each item brief and focused
- Group related changes when possible
- Prioritize important changes first
- Avoid listing every file change; focus on logical changes

Guidelines for testing notes:
- Suggest how to verify the changes work
- Mention any edge cases to test
- Keep it practical and actionable`;

function buildUserPrompt(params: {
  branchName: string;
  changedFiles: string[];
  diff: string;
  customInstructions?: string;
}): string {
  const { branchName, changedFiles, diff, customInstructions } = params;

  let prompt = `Generate a PR title and description for the following changes.

Branch name: ${branchName}

Changed files:
${changedFiles.map((f) => `- ${f}`).join('\n')}

Diff:
\`\`\`diff
${diff}
\`\`\``;

  if (customInstructions) {
    prompt += `\n\nAdditional instructions:\n${customInstructions}`;
  }

  return prompt;
}

function truncateDiff(diff: string, maxTokens: number): string {
  const tokenCount = estimateTokenCount(diff);

  if (tokenCount <= maxTokens) {
    return diff;
  }

  const truncated = sliceByTokens(diff, 0, maxTokens);
  return `${truncated}\n\n... (diff truncated, ${tokenCount - maxTokens} tokens omitted)`;
}

export type AIProvider = 'openai' | 'google';

export function detectAvailableProvider(): AIProvider | null {
  if (process.env.OPENAI_API_KEY) {
    return 'openai';
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return 'google';
  }
  return null;
}

export async function getModel(
  provider: AIProvider,
): Promise<{ model: LanguageModel; label: string }> {
  if (provider === 'openai') {
    const { openai } = await import('@ai-sdk/openai');
    return {
      model: openai('gpt-5-mini'),
      label: 'gpt-5-mini',
    };
  }

  const { google } = await import('@ai-sdk/google');
  return {
    model: google('gemini-2.5-flash'),
    label: 'gemini-2.5-flash',
  };
}

export async function generatePRContent(params: {
  branchName: string;
  changedFiles: string[];
  diff: string;
  config: CreatePRConfig;
}): Promise<GeneratedPRContent> {
  const { branchName, changedFiles, diff, config } = params;

  const preferredProvider = config.preferredProvider;
  let provider: AIProvider | null = null;

  if (preferredProvider) {
    const hasKey =
      preferredProvider === 'openai' ?
        Boolean(process.env.OPENAI_API_KEY)
      : Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

    if (hasKey) {
      provider = preferredProvider;
    }
  }

  if (!provider) {
    provider = detectAvailableProvider();
  }

  if (!provider) {
    throw new Error(
      'No AI provider available. Set OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.',
    );
  }

  const maxTokens = config.maxDiffTokens ?? DEFAULT_MAX_DIFF_TOKENS;
  const truncatedDiff = truncateDiff(diff, maxTokens);

  const { model, label } = await getModel(provider);

  console.log(`🤖 Using ${label} to generate PR description...`);

  const userPrompt = buildUserPrompt({
    branchName,
    changedFiles,
    diff: truncatedDiff,
    customInstructions: config.descriptionInstructions,
  });

  const result = await generateObject({
    model,
    schema: prContentSchema,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal: globalAbortSignal,
  });

  return result.object;
}
