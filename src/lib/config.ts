import { existsSync } from 'fs';
import { join } from 'path';
import type { LanguageModel, JSONValue } from 'ai';

/**
 * Configuration for a custom AI model used in code review.
 */
export type CustomModelConfig = {
  /** Optional display name for this model in logs and output */
  label?: string;
  /** Vercel AI SDK LanguageModel instance (e.g., openai('gpt-5'), google('gemini-2.5-pro')) */
  model: LanguageModel;
  /** Provider-specific options passed to the model (e.g., { reasoningEffort: 'high' } for OpenAI) */
  providerOptions?: Record<string, JSONValue>;
};

/**
 * A named setup configuration for code review models.
 * Allows full control over which models are used for each review phase.
 */
export type SetupConfig = {
  /** Name of this setup, used for selection via CLI --setup flag */
  label: string;
  /** Models that perform parallel code reviews. At least one reviewer is required. */
  reviewers: CustomModelConfig[];
  /** Model that validates and consolidates findings from all reviewers. Defaults to first reviewer if not specified. */
  validator?: CustomModelConfig;
  /** Model that formats the final output to structured JSON. Defaults to gpt-5-mini if not specified. */
  formatter?: CustomModelConfig;
};

/**
 * Context provided to scope's getFiles function with all available file lists.
 */
export type ScopeContext = {
  /** Files currently staged for commit */
  stagedFiles: string[];
  /** All files changed compared to base branch (or PR files if reviewing a PR) */
  allFiles: string[];
};

/**
 * Configuration for a custom review scope.
 * Allows defining which files should be included in the review.
 */
export type ScopeConfig = {
  /** Name of this scope, used for selection via CLI --scope flag */
  label: string;
  /** Function that receives available file lists and returns the files to review */
  getFiles: (ctx: ScopeContext) => string[] | Promise<string[]>;
};

export type ReviewCodeChangesConfig = {
  /**
   * Base branch for comparing changes.
   * Can be a static string or a function that receives the current branch name.
   * @default 'main'
   * @example 'develop'
   * @example (currentBranch) => currentBranch.startsWith('release/') ? 'main' : 'develop'
   */
  baseBranch?: string | ((currentBranch: string) => string);

  /**
   * Glob patterns to exclude files from the code review diff.
   * @example ['*.lock', 'dist/**', '*.generated.ts']
   */
  codeReviewDiffExcludePatterns?: string[];

  /**
   * Path to a markdown file containing custom review instructions/guidelines.
   * These instructions are included in the prompt sent to reviewers.
   * @example './REVIEW_GUIDELINES.md'
   */
  reviewInstructionsPath?: string;

  /**
   * Array of custom named setups with full control over reviewer, validator, and formatter models.
   * Each setup has a label that can be selected via the CLI --setup flag.
   * Custom setups take precedence over built-in presets when labels match.
   */
  setup?: SetupConfig[];

  /**
   * Array of custom review scopes that determine which files are included in the review.
   * Each scope has a label that can be selected via the CLI --scope flag.
   * Custom scopes take precedence over built-in scopes when labels match.
   */
  scope?: ScopeConfig[];

  /**
   * Default validator model used when a setup doesn't specify one.
   * Falls back to first reviewer in the setup if not specified.
   */
  defaultValidator?: CustomModelConfig;

  /**
   * Default formatter model used when a setup doesn't specify one.
   * Falls back to gpt-5-mini if not specified.
   */
  defaultFormatter?: CustomModelConfig;

  /**
   * Directory for storing review logs.
   * Can also be set via `AI_CLI_LOGS_DIR` environment variable.
   * Config value takes precedence over env var.
   */
  logsDir?: string;
};

export type Config = {
  /**
   * Configuration for the review-code-changes command.
   */
  reviewCodeChanges?: ReviewCodeChangesConfig;
};

export function defineConfig(config: Config): Config {
  return config;
}

let cachedConfig: Config | undefined = undefined;

export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }

  const configPath = join(cwd, 'ai-cli.config.ts');

  if (!existsSync(configPath)) {
    cachedConfig = {};
    return cachedConfig;
  }

  try {
    const configModule = (await import(configPath)) as { default?: Config };
    cachedConfig = configModule.default ?? {};
    return cachedConfig;
  } catch (error) {
    console.warn(`Warning: Failed to load config from ${configPath}:`, error);
    cachedConfig = {};
    return cachedConfig;
  }
}

export function clearConfigCache(): void {
  cachedConfig = undefined;
}

/**
 * Resolves the base branch from config, supporting both string and function forms.
 */
export function resolveBaseBranch(
  configBaseBranch: ReviewCodeChangesConfig['baseBranch'],
  currentBranch: string,
  defaultBranch = 'main',
): string {
  if (configBaseBranch === undefined) return defaultBranch;
  if (typeof configBaseBranch === 'function')
    return configBaseBranch(currentBranch);
  return configBaseBranch;
}

/**
 * Gets the code review diff exclude patterns from config.
 */
export function getExcludePatterns(
  config: ReviewCodeChangesConfig,
): string[] | undefined {
  return config.codeReviewDiffExcludePatterns;
}

/**
 * Resolves the logs directory from config or environment variable.
 * Config value takes precedence over env var.
 */
export function resolveLogsDir(
  config: ReviewCodeChangesConfig,
): string | undefined {
  return config.logsDir ?? process.env.AI_CLI_LOGS_DIR;
}
