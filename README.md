# ai-cmds

AI-powered code review CLI tool that uses OpenAI GPT-5 and Google Gemini models to review code changes. Supports reviewing PRs, staged changes, or all changes against a base branch.

## Features

- Multiple AI models: GPT-5, GPT-5-mini, Gemini 2.5 Pro, Gemini 2.5 Flash Lite
- Configurable review setups from very light to heavy
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
ai-cmds review-code --scope staged

# Review a specific PR
ai-cmds review-code --pr 123

# Review all changes against base branch
ai-cmds review-code --scope all

# Use a specific review setup
ai-cmds review-code --setup light

# Specify base branch
ai-cmds review-code --scope all --base-branch develop
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
  baseBranch: 'main',
  excludePatterns: ['pnpm-lock.yaml', '**/*.svg', '**/*.test.ts'],
  reviewInstructionsPath: '.github/PR_REVIEW_AGENT.md',
  defaultSetup: 'light',
});
```

### Configuration Options

| Option | Description |
|--------|-------------|
| `baseBranch` | Default base branch for diff comparison |
| `excludePatterns` | Glob patterns for files to exclude from review |
| `reviewInstructionsPath` | Path to custom review instructions |
| `defaultSetup` | Default review setup to use |
| `logsDir` | Directory for logs (requires `PR_REVIEW_LOGS` env) |

## License

MIT
