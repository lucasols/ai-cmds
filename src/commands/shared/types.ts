import type { JSONValue, LanguageModel } from 'ai';

export type Model = {
  model: LanguageModel;
  label?: string;
  config?: {
    providerOptions?: Record<string, Record<string, JSONValue>>;
    topP?: number | false;
    temperature?: number;
  };
};

export type LocalReviewContext = {
  type: 'local';
  additionalInstructions?: string;
};

export type PRReviewContext = {
  type: 'pr';
  prNumber: string;
  mode: 'gh-actions' | 'test';
  additionalInstructions?: string;
};

export type ReviewContext = LocalReviewContext | PRReviewContext;

export function isPRContext(ctx: ReviewContext): ctx is PRReviewContext {
  return ctx.type === 'pr';
}

export function isLocalContext(ctx: ReviewContext): ctx is LocalReviewContext {
  return ctx.type === 'local';
}

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number | undefined;
  model: string;
};

export type LLMDebugTrace = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  model: {
    id: string;
    provider: string;
  };
  config: Model['config'] | undefined;
  result: {
    text: string;
    finishReason: unknown;
    steps: unknown;
    response: unknown;
    warnings: unknown;
    request: unknown;
    providerMetadata: unknown;
    experimentalOutput: unknown;
  };
};

export type IndividualReview = {
  reviewerId: number | 'previous-review-checker';
  content: string;
  usage: TokenUsage;
  debug?: LLMDebugTrace;
};

export type ReviewIssue = {
  category:
    | 'critical'
    | 'possible'
    | 'suggestion'
    | 'not-applicable-or-false-positive';
  files: { path: string; line: number | null }[];
  description: string;
  currentCode: string | null;
  suggestedFix: string | null;
};

export type ValidatedReview = {
  issues: ReviewIssue[];
  summary: string;
  usage: TokenUsage;
  debug?: LLMDebugTrace;
};

export type PRData = {
  title: string;
  changedFiles: number;
  baseRefName: string;
  headRefName: string;
  author: { login: string };
};

export type GeneralPRComment = {
  author: string;
  body: string;
  createdAt: string;
};

export type ReviewScope = 'all' | 'staged';
