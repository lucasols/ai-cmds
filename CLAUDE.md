# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered code review CLI tool (ai-cmds) that uses OpenAI GPT-5 and Google Gemini models to review code changes. Supports reviewing PRs, staged changes, or all changes against a base branch.

## Commands

```bash
# Development
pnpm build:watch          # Watch mode for development
pnpm test                 # Run tests with Vitest
pnpm test:ui              # Tests in UI mode
pnpm lint                 # TypeScript + ESLint + Prettier check
pnpm format               # Auto-format with Prettier

# Build
pnpm build                # Full build (tests + lint + tsdown)
pnpm build:no-test        # Build without tests

# Run single test
pnpm vitest run tests/config.test.ts
```

## Architecture

```
src/
├── main.ts                      # CLI entry point
├── index.ts                     # Public exports (defineConfig)
├── commands/
│   └── review-code-changes/
│       ├── index.ts             # Command handler, orchestrates review flow
│       ├── reviewer.ts          # Executes AI reviews with tool use
│       ├── setups.ts            # Model configurations (veryLight → heavy)
│       ├── prompts.ts           # Review instruction templates
│       ├── output.ts            # Result formatting, PR comments, token accounting
│       └── types.ts             # TypeScript types
└── lib/
    ├── config.ts                # Loads ai-cmds.config.ts from project root
    ├── git.ts                   # Git operations (diff, changed files)
    ├── github.ts                # GitHub API via `gh` CLI
    ├── shell.ts                 # Command execution wrapper
    └── ai-tools.ts              # AI tools: readFile, listDirectory, ripgrep
```

**Review Flow:**

1. Load config from `ai-cmds.config.ts`
2. Fetch diff based on scope (pr/staged/all)
3. Run parallel AI reviews using configured setup
4. Validate findings with separate model pass
5. Format results to markdown, optionally post to PR

## Key Patterns

- Uses `@ls-stack/cli` for command definition and argument parsing
- Uses Vercel AI SDK (`ai`) with OpenAI and Google providers
- Result types via `t-result` for error handling
- Schema validation with `zod`
- Git/GitHub operations via shell commands (`git`, `gh` CLI)

## Configuration

Projects using this CLI create `ai-cmds.config.ts`:

```typescript
import { defineConfig } from 'ai-cmds';

export default defineConfig({
  reviewCodeChanges: {
    baseBranch: 'main',
    codeReviewDiffExcludePatterns: ['*.lock'],
    reviewInstructionsPath: './REVIEW_GUIDELINES.md',
  },
});
```

## Requirements

- Node.js ≥ 25.0.0
- pnpm (package manager)
- `gh` CLI for GitHub operations

## Implementing features or changes

After implementing a feature or changing the code:

- Update the README.md to reflect the changes
