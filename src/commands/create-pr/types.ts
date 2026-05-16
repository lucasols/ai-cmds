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
  preferredProvider?: 'openai' | 'google' | 'cerebras' | 'groq';

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

export type GeneratedPRContent = {
  title: string;
  summary: string;
  changes: string[];
  testingNotes: string;
};
