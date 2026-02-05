import type { JSONValue, LanguageModel } from 'ai';
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

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
  /** Identifier for this setup, used for selection via CLI --setup flag */
  id: string;
  /** Display label shown in UI */
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
  /** Identifier for this scope, used for selection via CLI --scope flag */
  id: string;
  /** Display label shown in UI */
  label: string;
  /** Function that receives available file lists and returns the files to review */
  getFiles: (ctx: ScopeContext) => string[] | Promise<string[]>;
  showFileCount?: boolean;
};

export type ReviewCodeChangesConfig = {
  /**
   * Base branch for comparing changes.
   * Can be a static string or a function that receives the current branch name.
   * If not set, the user will be prompted to select from available branches.
   * @example 'main'
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

export type CreatePRConfig = {
  /**
   * Path to the PR template file.
   * @default '.github/pull_request_template.md'
   */
  templatePath?: string;

  /**
   * Base branch for the PR.
   * Can be a static string or a function that receives the current branch name.
   * If not set, the user will be prompted to select from available branches.
   * @example 'main'
   * @example 'develop'
   * @example (currentBranch) => currentBranch.startsWith('release/') ? 'main' : 'develop'
   */
  baseBranch?: string | ((currentBranch: string) => string);

  /**
   * Preferred AI provider for generating PR descriptions.
   * The tool will auto-detect available providers based on API keys if not specified.
   */
  preferredProvider?: 'openai' | 'google';

  /**
   * Custom instructions to include in the AI prompt for generating descriptions.
   * @example 'Always mention Jira ticket if present in branch name'
   */
  descriptionInstructions?: string;

  /**
   * Glob patterns to exclude files from the diff used for AI description generation.
   * @example ['*.lock', 'dist/**']
   */
  diffExcludePatterns?: string[];

  /**
   * Maximum number of tokens to include from the diff in the AI prompt.
   * @default 50000
   */
  maxDiffTokens?: number;
};

export type Config = {
  /**
   * Configuration for the review-code-changes and review-pr commands.
   */
  codeReview?: ReviewCodeChangesConfig;

  /**
   * Configuration for the create-pr command.
   */
  createPR?: CreatePRConfig;

  /**
   * Controls loading of environment variables from `.env` files.
   *
   * By default, a `.env` file in the project root is loaded automatically before
   * the config module is imported, allowing the config to reference env vars.
   *
   * - `true` (default): Load `.env` from project root
   * - `false`: Skip loading any `.env` files
   * - `string`: Path to a specific `.env` file to load (in addition to the default `.env`)
   * - `string[]`: Array of paths to load in order (in addition to the default `.env`)
   *
   * @example
   * // Load additional environment file
   * loadDotEnv: '.env.local'
   *
   * @example
   * // Load multiple files (later files override earlier ones)
   * loadDotEnv: ['.env', '.env.local', '.env.development']
   *
   * @example
   * // Disable automatic .env loading
   * loadDotEnv: false
   */
  loadDotEnv?: boolean | string | string[];
};

export function defineConfig(config: Config): Config {
  return config;
}

let cachedConfig: Config | undefined = undefined;
let configImportCounter = 0;

function loadEnvFile(filePath: string, override = false): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  dotenvConfig({ path: filePath, override, quiet: true });
  return true;
}

function loadDotEnvFiles(config: Config, cwd: string): void {
  const { loadDotEnv } = config;

  if (loadDotEnv === false) {
    return;
  }

  // Additional env files should override existing values
  if (typeof loadDotEnv === 'string') {
    loadEnvFile(join(cwd, loadDotEnv), true);
    return;
  }

  if (Array.isArray(loadDotEnv)) {
    for (const envPath of loadDotEnv) {
      loadEnvFile(join(cwd, envPath), true);
    }
  }
}

export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }

  const configPath = join(cwd, 'ai-cmds.config.ts');
  const defaultEnvPath = join(cwd, '.env');

  // Load default .env file first so config module can access env vars
  loadEnvFile(defaultEnvPath);

  if (!existsSync(configPath)) {
    cachedConfig = {};
    return cachedConfig;
  }

  try {
    // Add cache-busting query parameter to force Node.js to re-import
    const importPath = `${configPath}?v=${configImportCounter++}`;
    const configModule = (await import(importPath)) as { default?: Config };
    cachedConfig = configModule.default ?? {};

    // Load additional env files specified in config
    loadDotEnvFiles(cachedConfig, cwd);

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
 * Returns undefined if no base branch is configured.
 */
export function resolveBaseBranch(
  configBaseBranch:
    | ReviewCodeChangesConfig['baseBranch']
    | CreatePRConfig['baseBranch'],
  currentBranch: string,
): string | undefined {
  if (configBaseBranch === undefined) return undefined;
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
