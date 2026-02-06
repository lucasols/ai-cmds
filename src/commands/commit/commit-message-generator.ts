import { generateObject, type JSONValue, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { CommitConfig, CustomModelConfig } from '../../lib/config.ts';

const commitMessageSchema = z.object({
  subject: z
    .string()
    .describe(
      'Concise commit subject line (50 chars ideal, 72 max). Imperative mood. No period at end.',
    ),
  body: z
    .string()
    .optional()
    .describe(
      'Optional commit body explaining what and why (not how). Wrap at 72 chars.',
    ),
});

const systemPrompt = `You are a helpful assistant that generates clear, professional git commit messages following conventional commit best practices.

Guidelines for the subject line:
- Use imperative mood ("Add feature" not "Added feature")
- Keep it concise: 50 characters is ideal, 72 is the hard max
- Do not end with a period
- Capitalize the first letter
- Focus on WHAT was done and WHY, not HOW
- If changes span multiple areas, summarize the overall intent

Guidelines for the body (optional):
- Only include a body if the subject alone doesn't fully explain the change
- Explain the motivation for the change
- Contrast the new behavior with the old behavior if relevant
- Wrap lines at 72 characters
- Do not repeat the subject line`;

function buildUserPrompt(diff: string, instructions?: string): string {
  let prompt = `Generate a commit message for the following staged changes.

Diff:
\`\`\`diff
${diff}
\`\`\``;

  if (instructions) {
    prompt += `\n\nAdditional instructions:\n${instructions}`;
  }

  return prompt;
}

function getProviderId(model: LanguageModel): string {
  if (typeof model === 'string') {
    return 'unknown';
  }
  return model.provider;
}

type ResolvedModel = {
  model: LanguageModel;
  label: string;
  providerOptions: Record<string, Record<string, JSONValue>> | undefined;
};

async function resolveModel(
  customModel: CustomModelConfig | undefined,
  fallbackProvider: 'google' | 'openai',
): Promise<ResolvedModel> {
  if (customModel) {
    return {
      model: customModel.model,
      label: customModel.label ?? 'custom model',
      providerOptions:
        customModel.providerOptions ?
          { [getProviderId(customModel.model)]: customModel.providerOptions }
        : undefined,
    };
  }

  if (fallbackProvider === 'google') {
    const { google } = await import('@ai-sdk/google');
    return {
      model: google('gemini-2.5-flash'),
      label: 'gemini-2.5-flash',
      providerOptions: undefined,
    };
  }

  const { openai } = await import('@ai-sdk/openai');
  return {
    model: openai('gpt-5-mini'),
    label: 'gpt-5-mini',
    providerOptions: undefined,
  };
}

export async function generateCommitMessage(
  diff: string,
  config: CommitConfig,
): Promise<string> {
  const userPrompt = buildUserPrompt(diff, config.instructions);

  const primary = await resolveModel(config.primaryModel, 'google');

  try {
    console.log(`🤖 Generating commit message with ${primary.label}...`);

    const result = await generateObject({
      model: primary.model,
      schema: commitMessageSchema,
      system: systemPrompt,
      prompt: userPrompt,
      providerOptions: primary.providerOptions,
    });

    return formatCommitMessage(result.object);
  } catch {
    console.warn(
      `⚠️  Primary model (${primary.label}) failed, trying fallback...`,
    );

    const fallback = await resolveModel(config.fallbackModel, 'openai');

    console.log(`🤖 Generating commit message with ${fallback.label}...`);

    const result = await generateObject({
      model: fallback.model,
      schema: commitMessageSchema,
      system: systemPrompt,
      prompt: userPrompt,
      providerOptions: fallback.providerOptions,
    });

    return formatCommitMessage(result.object);
  }
}

function formatCommitMessage(message: {
  subject: string;
  body?: string;
}): string {
  if (message.body) {
    return `${message.subject}\n\n${message.body}`;
  }

  return message.subject;
}
