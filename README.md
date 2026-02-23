# ai-cmds

AI-powered CLI tool that uses OpenAI and Google Gemini models to review code changes and create PRs with AI-generated descriptions.

## Features

- Multiple AI models: GPT-5, GPT-5-mini, GPT-4o-mini, Gemini 2.5 Pro, Gemini 2.0 Flash
- Configurable review setups from light to heavy
- Custom setups with full control over reviewer and validator models
- Six commands: `commit` for AI commit messages, `review-code-changes` for local development, `advanced-review-changes` for guided/customized local review focus, `review-pr` for CI, `create-pr` for PR creation, `set-global-envs` for global API key setup
- Parallel reviews with a single structured validation pass for higher accuracy
- Optional provider-aware concurrency limits for reviewer fan-out
- AI-generated commit messages with interactive editing
- AI-generated PR titles and descriptions
- Automatic filtering of import-only changes
- Custom review instructions support
- Token usage tracking and cost awareness
- Improved review visualization with severity totals, issue IDs (`C1`, `P1`, `S1`), and impacted file counts

## Installation

```bash
npm install ai-cmds
# or
pnpm add ai-cmds
```

## Requirements

- Node.js >= 25.0.0
- `gh` CLI for GitHub PR operations
- `OPENAI_API_KEY` environment variable (for OpenAI setups)
- `GOOGLE_GENERATIVE_AI_API_KEY` environment variable (for Google setups)

## Commands

### `commit` - AI Commit Messages

Generate commit messages from staged changes using AI (Gemini primary, GPT-5-mini fallback).

```bash
# Generate commit message and commit
ai-cmds commit

# Preview message without committing
ai-cmds commit --dry-run
```

**Arguments:**

- `--dry-run` - Preview the generated message without committing

**Behavior:**

- If no files are staged, automatically stages all changes before generating
- Lockfiles are excluded from the diff sent to AI by default
- After generation, choose to: **Commit**, **Edit**, **Regenerate**, or **Cancel**
- If the primary model fails, automatically retries with the fallback model

### `review-code-changes` - Local Development

Review local code changes (staged or all changes vs base branch). Best for local development workflow.

```bash
# Review staged changes
ai-cmds review-code-changes --scope staged

# Review all changes against base branch
ai-cmds review-code-changes --scope all

# Use a specific review setup
ai-cmds review-code-changes --setup light

# Specify base branch
ai-cmds review-code-changes --scope all --base-branch develop

# Save review to a custom file path
ai-cmds review-code-changes --scope all --output reviews/local-review.md
```

**Arguments:**

- `--scope` - Review scope: `all`, `staged`, `globs`, `unViewed`, or custom scope id
- `--setup` - Review setup: `light`, `medium`, `heavy`, or custom setup id
- `--base-branch` - Base branch for diff comparison (if not specified, prompts for selection)
- `--output` - Output file path for the generated review markdown (default: `pr-review.md`)

### `advanced-review-changes` - Advanced Local Development

Review local code changes with the same flow as `review-code-changes`, plus extra control over review guidance.

```bash
# Guided mode (prompts for custom instruction and instruction inclusion)
ai-cmds advanced-review-changes

# Pass a custom review focus instruction
ai-cmds advanced-review-changes --custom-review-instruction "Focus on authentication and authorization issues"

# Disable default/configured instructions and only use your custom instruction
ai-cmds advanced-review-changes \
  --custom-review-instruction "Focus on performance bottlenecks and N+1 queries" \
  --include-default-review-instructions false
```

**Arguments:**

- `--scope` - Review scope: `all`, `staged`, `globs`, `unViewed`, or custom scope id
- `--setup` - Review setup: `light`, `medium`, `heavy`, or custom setup id
- `--base-branch` - Base branch for diff comparison (if not specified, prompts for selection)
- `--output` - Output file path for the generated review markdown (default: `pr-review.md`)
- `--custom-review-instruction` - Extra custom instruction that tells reviewers what to focus on
- `--include-default-review-instructions` - Whether to include configured/default instructions (`true` or `false`)

**Interactive behavior:**

- If `--include-default-review-instructions` is not provided, the CLI shows a confirm dialog.
- If `--custom-review-instruction` is not provided, the CLI asks whether you want to add one and prompts for it if confirmed.

### `review-pr` - CI/PR Review

Review a specific GitHub PR. Designed for CI environments (GitHub Actions) but can also be used locally.

```bash
# Review PR #123
ai-cmds review-pr --pr 123

# Review PR without posting comment (test mode)
ai-cmds review-pr --pr 123 --test

# Heavy review of a PR
ai-cmds review-pr --pr 123 --setup heavy
```

**Arguments:**

- `--pr` - PR number to review (**required**)
- `--setup` - Review setup: `light`, `medium`, `heavy`, or custom setup id
- `--test` - Test mode: skip posting review to PR, just save to file
- `--skip-previous-check` - Skip checking if previous review issues are still present

**Behavior:**

- In GitHub Actions (`GITHUB_ACTIONS` env set): Posts review as PR comment
- With `--test` flag or locally: Saves review to `pr-review-test.md`
- If the filtered diff has no reviewable code (for example import/export-only changes), the command skips AI calls and emits a no-issues review
- Reviewer fan-out respects `codeReview.concurrencyPerProvider` when configured

**Previous Review Check:**

When running in GitHub Actions mode, the tool automatically checks if there's a previous AI review on the PR. If issues were found in a previous review, it verifies whether those issues are still present in the current code. This helps track if feedback has been addressed without requiring a full re-review.

- Only runs in `gh-actions` mode (not in `--test` mode)
- Looks for previous reviews posted by `github-actions[bot]`
- Only reports issues that are still present (fixed issues are not mentioned)
- Runs in parallel with regular reviews for efficiency
- Use `--skip-previous-check` to disable this feature

### `create-pr` - Create PR with AI Description

Create a GitHub PR with an AI-generated title and description based on your changes.

```bash
# Create PR with AI-generated description
ai-cmds create-pr

# Create PR against a specific base branch
ai-cmds create-pr --base develop

# Skip AI generation, use template only
ai-cmds create-pr --no-ai

# Preview without opening browser
ai-cmds create-pr --dry-run

# Override the PR title
ai-cmds create-pr --title "Fix login validation"
```

**Arguments:**

- `--base` - Base branch for the PR (if not specified, uses config or prompts)
- `--no-ai` - Skip AI generation and use template only
- `--dry-run` - Preview PR content without opening browser
- `--title` - Override the AI-generated PR title

**Behavior:**

- Checks if a PR already exists for the current branch
- Automatically pushes the branch if not already pushed
- Uses PR template from `.github/pull_request_template.md` (configurable)
- Supports `<!-- AI_DESCRIPTION -->` marker in templates for AI content placement
- Opens GitHub compare URL with pre-filled title and body

### `set-global-envs` - Global API Key Setup

Create a global `.env` file at `~/.config/ai-cmds/.env` for API keys shared across all projects.

```bash
ai-cmds set-global-envs
```

**Behavior:**

- Creates `~/.config/ai-cmds/.env` with commented-out placeholders for `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, and `AI_CLI_LOGS_DIR`
- If the file already exists, reports its location without overwriting
- The global `.env` is always loaded first, then the local `.env` overrides any overlapping variables

## Review Setups

| Setup    | Reviewers                   | Description        |
| -------- | --------------------------- | ------------------ |
| `light`  | 1× GPT-5                    | Balanced           |
| `medium` | 2× GPT-5 (medium reasoning) | More thorough      |
| `heavy`  | 2× GPT-5 (xhigh reasoning)  | Most comprehensive |

## Review Scopes

| Scope      | Description                                                    |
| ---------- | -------------------------------------------------------------- |
| `all`      | All changes compared to base branch                            |
| `staged`   | Only staged changes                                            |
| `globs`    | Interactive glob pattern selection (use `!pattern` to exclude) |
| `unViewed` | Unviewed files in PR (requires open PR for current branch)     |

### Using the `globs` Scope

The `globs` scope allows you to select files using glob patterns interactively:

```bash
ai-cmds review-code-changes --scope globs
# Then enter patterns like: src/**/*.ts !**/*.test.ts
```

Pattern syntax:

- `src/**/*.ts` - Include all TypeScript files in src
- `!**/*.test.ts` - Exclude test files
- `components` - Simple folder names are expanded to `**/components/**`

### Using the `unViewed` Scope

The `unViewed` scope reviews only files you haven't marked as "viewed" in the GitHub PR interface:

```bash
ai-cmds review-code-changes --scope unViewed
```

This requires an open PR for the current branch. It uses the GitHub GraphQL API to fetch the viewed state of each file.

## Configuration

Create `ai-cmds.config.ts` in your project root:

```typescript
import { defineConfig } from 'ai-cmds';

export default defineConfig({
  codeReview: {
    baseBranch: 'main',
    codeReviewDiffExcludePatterns: [
      'pnpm-lock.yaml',
      '**/*.svg',
      '**/*.test.ts',
    ],
    reviewInstructionsPath: '.github/PR_REVIEW_AGENT.md',
    includeAgentsFileInReviewPrompt: true,
    concurrencyPerProvider: {
      'openai.responses': 2,
      'google.generative-ai': 1,
    },
  },
  createPR: {
    baseBranch: 'main',
    diffExcludePatterns: ['pnpm-lock.yaml'],
    descriptionInstructions:
      'Always mention Jira ticket if present in branch name',
  },
  commit: {
    maxDiffTokens: 10000,
    excludePatterns: ['dist/**'],
    instructions: 'Always include the Jira ticket number from the branch name',
  },
});
```

### Environment Variables

The CLI automatically loads environment variables from `.env` files in your project root. You can customize this behavior with the `loadDotEnv` option:

```typescript
export default defineConfig({
  // Load additional env files (later files override earlier ones)
  loadDotEnv: ['.env.local', '.env.development'],

  // Or load a single additional file
  loadDotEnv: '.env.local',

  // Or disable automatic .env loading
  loadDotEnv: false,
});
```

By default, the global `~/.config/ai-cmds/.env` is loaded first (see [`set-global-envs`](#set-global-envs---global-api-key-setup)), then the local `.env` is loaded and overrides any overlapping variables. This allows you to set shared API keys globally while still customizing per-project.

### Configuration Options

#### Root Options

| Option       | Description                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadDotEnv` | Controls `.env` file loading. `true` (default): load `.env`, `false`: skip, `string`: additional file path, `string[]`: multiple files (later override earlier) |
| `codeReview` | Configuration for the review commands (see below)                                                                                                               |
| `createPR`   | Configuration for the create-pr command (see below)                                                                                                             |
| `commit`     | Configuration for the commit command (see below)                                                                                                                |

#### `codeReview` Options

| Option                            | Description                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseBranch`                      | Base branch for diff comparison. Can be a string or function `(currentBranch) => string`. If not set, prompts for selection                                                                                             |
| `codeReviewDiffExcludePatterns`   | Glob patterns for files to exclude from review                                                                                                                                                                          |
| `reviewInstructionsPath`          | Path to custom review instructions markdown file. Auto-detects `.agents/CODE_REVIEW.md` or `.agents/skills/code-review/SKILL.md` when not set. YAML frontmatter is stripped automatically. Set to `false` to disable    |
| `includeAgentsFileInReviewPrompt` | Include `<git-root>/AGENTS.md` content in reviewer prompts (default: `true`)                                                                                                                                            |
| `reviewOutputPath`                | Default output file path for `review-code-changes` (can be overridden by `--output`)                                                                                                                                    |
| `setup`                           | Array of custom named setups (see below)                                                                                                                                                                                |
| `scope`                           | Array of custom named scopes (see below)                                                                                                                                                                                |
| `defaultValidator`                | Default validator model for custom setups                                                                                                                                                                               |
| `maxDiffTokens`                   | Maximum tokens allowed in the diff. `review-pr` exits when exceeded (default: `60000`)                                                                                                                                  |
| `diffCompactor`                   | Array of steps to progressively filter files when diff exceeds `maxDiffTokens` (see below)                                                                                                                              |
| `concurrencyPerProvider`          | Reviewer concurrency limit. Use a number for all providers or `{ [providerId]: number }` for per-provider limits (keys come from `model.provider`, e.g. `openai.responses`; unspecified providers default to unlimited) |
| `logsDir`                         | Directory for review run artifacts (can also use `AI_CLI_LOGS_DIR` env var)                                                                                                                                             |

#### `createPR` Options

| Option                    | Description                                                                     |
| ------------------------- | ------------------------------------------------------------------------------- |
| `templatePath`            | Path to PR template file (default: `.github/pull_request_template.md`)          |
| `baseBranch`              | Base branch for the PR. Can be a string or function `(currentBranch) => string` |
| `preferredProvider`       | Preferred AI provider: `'openai'` or `'google'` (auto-detects if not set)       |
| `descriptionInstructions` | Custom instructions for AI description generation                               |
| `diffExcludePatterns`     | Glob patterns for files to exclude from diff                                    |
| `maxDiffTokens`           | Maximum tokens from diff to include in AI prompt (default: 50000)               |

#### `commit` Options

| Option            | Description                                                                           |
| ----------------- | ------------------------------------------------------------------------------------- |
| `primaryModel`    | Custom AI model for commit message generation (default: Gemini 2.5 Flash)             |
| `fallbackModel`   | Fallback AI model if primary fails (default: GPT-5-mini)                              |
| `maxDiffTokens`   | Maximum tokens from diff to include in AI prompt (default: 10000)                     |
| `excludePatterns` | Additional glob patterns to exclude from diff (merged with default lockfile patterns) |
| `instructions`    | Custom instructions for AI commit message generation                                  |

When `codeReview.logsDir` (or `AI_CLI_LOGS_DIR`) is set, each review run stores artifacts under:

- `<logsDir>/advanced-review-changes/<run-id>/...` for advanced local reviews
- `<logsDir>/review-code-changes/<run-id>/...` for local reviews
- `<logsDir>/review-pr/<run-id>/...` for PR reviews

Each run includes `context.yaml`, `changed-files.txt`, `diff.diff`, `reviewers/*.md`, `reviewers/*-debug.yaml`, `validator.yaml`, `final-review.md`, and `summary.yaml`.

### Dynamic Base Branch

The `baseBranch` option can be a function that receives the current branch name:

```typescript
export default defineConfig({
  codeReview: {
    baseBranch: (currentBranch) =>
      currentBranch.startsWith('release/') ? 'main' : 'develop',
  },
});
```

### Custom Setups

Define custom named setups with full control over which models are used. **When custom setups are configured, they replace built-in options** (light, medium, heavy).

```typescript
import { defineConfig } from 'ai-cmds';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

export default defineConfig({
  codeReview: {
    setup: [
      {
        id: 'myCustomSetup',
        label: 'myCustomSetup',
        reviewers: [
          {
            label: 'GPT-5',
            model: openai('gpt-5.2'),
            providerOptions: { openai: { reasoningEffort: 'high' } },
          },
          { model: google('gemini-2.5-pro') },
        ],
        validator: { model: openai('gpt-5.2') },
      },
      {
        id: 'fastReview',
        label: 'fastReview',
        reviewers: [{ model: openai('gpt-5-mini') }],
        // validator uses defaultValidator
      },
    ],

    // Default validator for custom setups that don't specify one
    defaultValidator: {
      model: openai('gpt-5.2'),
      providerOptions: { openai: { reasoningEffort: 'high' } },
    },
  },
});
```

To include built-in options alongside your custom setups, use `BUILT_IN_SETUP_OPTIONS`:

```typescript
import { defineConfig, BUILT_IN_SETUP_OPTIONS } from 'ai-cmds';

export default defineConfig({
  codeReview: {
    setup: [
      ...BUILT_IN_SETUP_OPTIONS, // includes light, medium, heavy
      { id: 'myCustomSetup', label: 'My Custom Setup', reviewers: [...] },
    ],
  },
});
```

Use custom setups via CLI:

```bash
ai-cmds review-code-changes --setup myCustomSetup
ai-cmds review-pr --pr 123 --setup myCustomSetup
```

### Custom Scopes

Define custom scopes to control which files are included in the review. **When custom scopes are configured, they replace built-in options** (all, staged).

```typescript
import { defineConfig } from 'ai-cmds';

export default defineConfig({
  codeReview: {
    scope: [
      {
        id: 'src-only',
        label: 'Source files only',
        diffSource: 'branch',
        getFiles: (ctx) => ctx.allFiles.filter((f) => f.startsWith('src/')),
      },
      {
        id: 'no-tests',
        label: 'Exclude tests',
        diffSource: 'branch',
        getFiles: (ctx) => ctx.allFiles.filter((f) => !f.includes('.test.')),
      },
    ],
  },
});
```

The `getFiles` function receives a context object with:

- `stagedFiles`: Files currently staged for commit
- `allFiles`: All files changed compared to base branch

The optional `diffSource` field controls which git diff source the scope uses:

- `'branch'` (default): compare against selected base branch
- `'staged'`: use staged changes

To include built-in options alongside your custom scopes, use `BUILT_IN_SCOPE_OPTIONS`:

```typescript
import { defineConfig, BUILT_IN_SCOPE_OPTIONS } from 'ai-cmds';

export default defineConfig({
  codeReview: {
    scope: [
      ...BUILT_IN_SCOPE_OPTIONS, // includes all, staged, globs, unViewed
      {
        id: 'src-only',
        label: 'Source files only',
        getFiles: (ctx) => ctx.allFiles.filter((f) => f.startsWith('src/')),
      },
    ],
  },
});
```

Use custom scopes via CLI:

```bash
ai-cmds review-code-changes --scope src-only
```

### Diff Compactor

When reviewing large PRs, the diff may exceed the `maxDiffTokens` limit (default: 60,000). Instead of hard-exiting, configure `diffCompactor` to progressively filter files until the diff fits:

```typescript
export default defineConfig({
  codeReview: {
    maxDiffTokens: 60_000,
    diffCompactor: [
      {
        name: 'Remove test files',
        filterFiles: (files) => files.filter((f) => !f.includes('.test.')),
      },
      {
        name: 'Source only',
        filterFiles: (files) => files.filter((f) => f.startsWith('src/')),
        ignoreAgentsMd: true,
      },
    ],
  },
});
```

Steps are applied in order. After each step the diff is re-fetched and checked against the limit. Processing stops as soon as the diff is small enough. If all steps are exhausted and the diff is still too large, `review-pr` exits with an error as before.

Each step supports an optional `ignoreAgentsMd` flag. When a step with `ignoreAgentsMd: true` is applied, the repository's `AGENTS.md` file is excluded from reviewer prompts to further reduce token usage.

## GitHub Actions Integration

Example workflow for running PR reviews in CI:

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '25'
          cache: 'pnpm'

      - run: pnpm install

      - name: Run AI Review
        run: pnpm ai-cmds review-pr --pr ${{ github.event.pull_request.number }}
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## License

MIT
