# ai-cmds

AI-powered code review CLI tool that uses OpenAI GPT-5 and Google Gemini models to review code changes. Supports reviewing PRs in CI environments or local changes during development.

## Features

- Multiple AI models: GPT-5, GPT-5-mini, Gemini 2.5 Pro, Gemini 2.5 Flash Lite
- Configurable review setups from very light to heavy
- Custom setups with full control over reviewer, validator, and formatter models
- Two commands: `review-code-changes` for local development, `review-pr` for CI
- Parallel reviews with validation pass for higher accuracy
- Automatic filtering of import-only changes
- Custom review instructions support
- Token usage tracking and cost awareness

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
```

**Arguments:**
- `--scope` - Review scope: `all` (all changes vs base) or `staged` (staged changes only)
- `--setup` - Review setup: `light`, `medium`, `heavy`, or custom setup label
- `--base-branch` - Base branch for diff comparison (default: `main`)

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
- `--setup` - Review setup: `light`, `medium`, `heavy`, or custom setup label
- `--test` - Test mode: skip posting review to PR, just save to file

**Behavior:**
- In GitHub Actions (`GITHUB_ACTIONS` env set): Posts review as PR comment
- With `--test` flag or locally: Saves review to `pr-review-test.md`

## Review Setups

| Setup | Reviewers | Description |
|-------|-----------|-------------|
| `veryLight` | 1× GPT-5-mini | Fastest, lowest cost |
| `light` | 1× GPT-5 | Balanced |
| `medium` | 2× GPT-5 (high reasoning) | More thorough |
| `heavy` | 4× GPT-5 (high reasoning) | Most comprehensive |
| `lightGoogle` | 1× Gemini 2.5 Pro | Google alternative |
| `mediumGoogle` | 2× Gemini 2.5 Pro | Google thorough |

## Configuration

Create `ai-cli.config.ts` in your project root:

```typescript
import { defineConfig } from 'ai-cmds';

export default defineConfig({
  reviewCodeChanges: {
    baseBranch: 'main',
    codeReviewDiffExcludePatterns: ['pnpm-lock.yaml', '**/*.svg', '**/*.test.ts'],
    reviewInstructionsPath: '.github/PR_REVIEW_AGENT.md',
  },
});
```

### Configuration Options (`reviewCodeChanges`)

| Option | Description |
|--------|-------------|
| `baseBranch` | Base branch for diff comparison. Can be a string or function `(currentBranch) => string` |
| `codeReviewDiffExcludePatterns` | Glob patterns for files to exclude from review |
| `reviewInstructionsPath` | Path to custom review instructions markdown file |
| `setup` | Array of custom named setups (see below) |
| `scope` | Array of custom named scopes (see below) |
| `defaultValidator` | Default validator model for custom setups |
| `defaultFormatter` | Default formatter model for custom setups |
| `logsDir` | Directory for logs (can also use `AI_CLI_LOGS_DIR` env var) |

### Dynamic Base Branch

The `baseBranch` option can be a function that receives the current branch name:

```typescript
export default defineConfig({
  reviewCodeChanges: {
    baseBranch: (currentBranch) =>
      currentBranch.startsWith('release/') ? 'main' : 'develop',
  },
});
```

### Custom Setups

Define custom named setups with full control over which models are used. **When custom setups are configured, they replace built-in options** (veryLight, light, medium, heavy).

```typescript
import { defineConfig } from 'ai-cmds';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

export default defineConfig({
  reviewCodeChanges: {
    setup: [
      {
        label: 'myCustomSetup',
        reviewers: [
          { label: 'GPT-5', model: openai('gpt-5.2'), providerOptions: { reasoningEffort: 'high' } },
          { model: google('gemini-2.5-pro') },
        ],
        validator: { model: openai('gpt-5.2') },
        formatter: { model: openai('gpt-5-mini') },
      },
      {
        label: 'fastReview',
        reviewers: [{ model: openai('gpt-5-mini') }],
        // validator and formatter use defaults
      },
    ],

    // Defaults for custom setups that don't specify validator/formatter
    defaultValidator: { model: openai('gpt-5.2'), providerOptions: { reasoningEffort: 'high' } },
    defaultFormatter: { model: openai('gpt-5-mini') },
  },
});
```

To include built-in options alongside your custom setups, use `BUILT_IN_SETUP_OPTIONS`:

```typescript
import { defineConfig, BUILT_IN_SETUP_OPTIONS } from 'ai-cmds';

export default defineConfig({
  reviewCodeChanges: {
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
  reviewCodeChanges: {
    scope: [
      {
        id: 'src-only',
        label: 'Source files only',
        getFiles: (ctx) => ctx.allFiles.filter((f) => f.startsWith('src/')),
      },
      {
        id: 'no-tests',
        label: 'Exclude tests',
        getFiles: (ctx) => ctx.allFiles.filter((f) => !f.includes('.test.')),
      },
    ],
  },
});
```

The `getFiles` function receives a context object with:
- `stagedFiles`: Files currently staged for commit
- `allFiles`: All files changed compared to base branch

To include built-in options alongside your custom scopes, use `BUILT_IN_SCOPE_OPTIONS`:

```typescript
import { defineConfig, BUILT_IN_SCOPE_OPTIONS } from 'ai-cmds';

export default defineConfig({
  reviewCodeChanges: {
    scope: [
      ...BUILT_IN_SCOPE_OPTIONS, // includes all, staged
      { id: 'src-only', label: 'Source files only', getFiles: (ctx) => ctx.allFiles.filter((f) => f.startsWith('src/')) },
    ],
  },
});
```

Use custom scopes via CLI:

```bash
ai-cmds review-code-changes --scope src-only
```

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
