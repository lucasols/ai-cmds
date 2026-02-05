# ai-cmds

AI-powered code review CLI tool that uses OpenAI GPT-5 and Google Gemini models to review code changes. Supports reviewing PRs, staged changes, or all changes against a base branch.

## Features

- Multiple AI models: GPT-5, GPT-5-mini, Gemini 2.5 Pro, Gemini 2.5 Flash Lite
- Configurable review setups from very light to heavy
- Custom setups with full control over reviewer, validator, and formatter models
- Review scopes: PR, staged changes, or all changes vs base branch
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

## Usage

```bash
# Review staged changes
ai-cmds review-code-changes --scope staged

# Review a specific PR
ai-cmds review-code-changes --pr 123

# Review all changes against base branch
ai-cmds review-code-changes --scope all

# Use a specific review setup
ai-cmds review-code-changes --setup light

# Specify base branch
ai-cmds review-code-changes --scope all --base-branch develop
```

### Review Setups

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
      ...BUILT_IN_SETUP_OPTIONS, // includes veryLight, light, medium, heavy
      { label: 'myCustomSetup', reviewers: [...] },
    ],
  },
});
```

Use custom setups via CLI:

```bash
ai-cmds review-code-changes --setup myCustomSetup
```

### Custom Scopes

Define custom scopes to control which files are included in the review. **When custom scopes are configured, they replace built-in options** (all, staged, pr).

```typescript
import { defineConfig } from 'ai-cmds';

export default defineConfig({
  reviewCodeChanges: {
    scope: [
      {
        label: 'src-only',
        getFiles: (ctx) => ctx.allFiles.filter((f) => f.startsWith('src/')),
      },
      {
        label: 'no-tests',
        getFiles: (ctx) => ctx.allFiles.filter((f) => !f.includes('.test.')),
      },
    ],
  },
});
```

The `getFiles` function receives a context object with:
- `stagedFiles`: Files currently staged for commit
- `allFiles`: All files changed compared to base branch (or PR files if reviewing a PR)

To include built-in options alongside your custom scopes, use `BUILT_IN_SCOPE_OPTIONS`:

```typescript
import { defineConfig, BUILT_IN_SCOPE_OPTIONS } from 'ai-cmds';

export default defineConfig({
  reviewCodeChanges: {
    scope: [
      ...BUILT_IN_SCOPE_OPTIONS, // includes all, staged, pr
      { label: 'src-only', getFiles: (ctx) => ctx.allFiles.filter((f) => f.startsWith('src/')) },
    ],
  },
});
```

Use custom scopes via CLI:

```bash
ai-cmds review-code-changes --scope src-only
```

## License

MIT
