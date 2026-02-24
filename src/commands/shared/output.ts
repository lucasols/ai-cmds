import { writeFile } from 'fs/promises';
import { styleText } from 'util';
import { git } from '../../lib/git.ts';
import { github } from '../../lib/github.ts';
import { runCmdSilentUnwrap } from '@ls-stack/node-utils/runShellCmd';
import { getModelEffort } from './reviewer.ts';
import type {
  ReviewContext,
  IndividualReview,
  ValidatedReview,
  TokenUsage,
  ReviewIssue,
} from './types.ts';

export const EXTRA_DETAILS_MARKER = '<!-- EXTRA_DETAILS -->';
export const PR_REVIEW_MARKER = 'AI_CLI_PR_REVIEW';

export function createZeroTokenUsage(model = 'none'): TokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    model,
  };
}

function formatNum(num: number): string {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function calculateReviewsUsage(reviews: IndividualReview[]): TokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let reasoningTokens = 0;

  for (const review of reviews) {
    promptTokens += review.usage.promptTokens || 0;
    completionTokens += review.usage.completionTokens || 0;
    totalTokens += review.usage.totalTokens || 0;
    reasoningTokens += review.usage.reasoningTokens || 0;
  }

  const models = [...new Set(reviews.map((review) => review.usage.model))];

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens: reasoningTokens || undefined,
    model: models.join(', ') || 'none',
  };
}

export function calculateTotalUsage(allUsages: TokenUsage[]): TokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let reasoningTokens = 0;

  for (const usage of allUsages) {
    promptTokens += usage.promptTokens;
    completionTokens += usage.completionTokens;
    totalTokens += usage.totalTokens;
    reasoningTokens += usage.reasoningTokens || 0;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens: reasoningTokens || undefined,
    model: 'total',
  };
}

function getIssueStats(issues: ReviewIssue[]): {
  critical: number;
  possible: number;
  suggestion: number;
  total: number;
  impactedFilesCount: number;
} {
  const critical = issues.filter(
    (issue) => issue.category === 'critical',
  ).length;
  const possible = issues.filter(
    (issue) => issue.category === 'possible',
  ).length;
  const suggestion = issues.filter(
    (issue) => issue.category === 'suggestion',
  ).length;

  const impactedFiles = new Set<string>();
  for (const issue of issues) {
    for (const file of issue.files) {
      if (file.path) impactedFiles.add(file.path);
    }
  }

  return {
    critical,
    possible,
    suggestion,
    total: critical + possible + suggestion,
    impactedFilesCount: impactedFiles.size,
  };
}

function formatTokenUsageSection(
  reviews: IndividualReview[],
  validatorUsage: TokenUsage,
  validatorProviderOptions: Record<string, Record<string, unknown>> | undefined,
): string {
  let content = '';

  const totalUsage = calculateTotalUsage([
    ...reviews.map((review) => review.usage),
    validatorUsage,
  ]);

  content += '**Total Token Usage:**\n';
  content += `- Input Tokens: ${formatNum(totalUsage.promptTokens)}\n`;
  content += `- Output Tokens: ${formatNum(totalUsage.completionTokens)}\n`;
  content += `- Total Tokens: ${formatNum(totalUsage.totalTokens)}\n`;
  content += `- Reasoning Tokens: ${formatNum(totalUsage.reasoningTokens || 0)}\n`;
  content += '\n';

  for (const review of reviews) {
    content += `**Reviewer ${review.reviewerId}:**\n`;
    content += `- Model: ${review.usage.model}\n`;
    content += `- Effort: ${getModelEffort(review.debug?.config?.providerOptions)}\n`;
    content += `- Input Tokens: ${formatNum(review.usage.promptTokens || 0)}\n`;
    content += `- Output Tokens: ${formatNum(review.usage.completionTokens || 0)}\n`;
    content += `- Total Tokens: ${formatNum(review.usage.totalTokens || 0)}\n`;
    content += `- Reasoning Tokens: ${formatNum(review.usage.reasoningTokens || 0)}\n`;
    content += '\n';
  }

  content += '**Validator:**\n';
  content += `- Model: ${validatorUsage.model}\n`;
  content += `- Effort: ${getModelEffort(validatorProviderOptions)}\n`;
  content += `- Input Tokens: ${formatNum(validatorUsage.promptTokens)}\n`;
  content += `- Output Tokens: ${formatNum(validatorUsage.completionTokens)}\n`;
  content += `- Total Tokens: ${formatNum(validatorUsage.totalTokens)}\n`;
  content += `- Reasoning Tokens: ${formatNum(validatorUsage.reasoningTokens || 0)}\n`;
  content += '\n';

  return content;
}

function getExtensionFromFileName(fileName: string) {
  const extension = fileName.split('.').pop();
  if (!extension) return 'txt';
  return extension;
}

function getCodeBlock(code: string, extension: string | undefined) {
  if (code.includes('```')) return code.trim();
  return `\`\`\`${extension || ''}\n${code}\n\`\`\`\n`;
}

function stripMarkdownHeadings(markdown: string): string {
  return markdown.replace(/^#{1,6}\s+/gm, '');
}

function normalizeMarkdownSpacing(markdown: string): string {
  const lines = markdown
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''));
  const normalized: string[] = [];
  let blankRun = 0;
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      blankRun = 0;
      normalized.push(line);
      continue;
    }

    const isBlank = trimmed.length === 0;
    if (!inCodeFence && isBlank) {
      blankRun += 1;
      if (blankRun > 1) {
        continue;
      }
      normalized.push('');
      continue;
    }

    blankRun = 0;
    normalized.push(line);
  }

  return `${normalized.join('\n').trim()}\n`;
}

function getIssueCopyPastePrompt(issue: ReviewIssue) {
  const firstFile = issue.files[0];
  const fileContext =
    issue.files.length === 0 ? ''
    : issue.files.length === 1 && firstFile ?
      ` in ${firstFile.path}${firstFile.line ? `:${firstFile.line}` : ''}`
    : ` in files: ${issue.files.map((f) => `${f.path}${f.line ? `:${f.line}` : ''}`).join(', ')}`;

  let textToAppend = `
Please review and fix the following code issue${fileContext}. First double check if the problem really applies to the code, then implement a fix.

${issue.description}`;

  if (issue.currentCode) {
    const extension =
      issue.files.length === 1 && firstFile ?
        getExtensionFromFileName(firstFile.path)
      : '';
    textToAppend += `

Here is the current code:

${getCodeBlock(issue.currentCode, extension)}
`;
  }

  if (issue.suggestedFix) {
    textToAppend += `
Here is the suggested fix:

${stripMarkdownHeadings(issue.suggestedFix)}
`;
  }

  return `~~~~markdown\n${textToAppend.trim()}\n~~~~`;
}

function formatIssueSummaryLine(
  prefix: string,
  categoryLabel: string,
  count: number,
): string {
  return `${prefix} ${categoryLabel}: ${count}`;
}

export function logValidatedIssueSummary(
  validatedReview: ValidatedReview,
): void {
  const stats = getIssueStats(validatedReview.issues);
  console.log(
    `📌 Findings summary: ${stats.total} total (${stats.critical} critical, ${stats.possible} possible, ${stats.suggestion} suggestions) across ${stats.impactedFilesCount} file(s)`,
  );
}

export async function formatValidatedReview(
  validatedReview: ValidatedReview,
  prAuthor: string,
  context: ReviewContext,
  headRefName: string,
  tokenUsage: {
    reviews: IndividualReview[];
    validatorUsage: TokenUsage;
    validatorProviderOptions?: Record<string, Record<string, unknown>>;
  },
): Promise<string> {
  const { summary, issues } = validatedReview;
  const isLocal = context.type === 'local';
  const isPR = context.type === 'pr';
  const isTestMode = isPR && context.mode === 'test';
  let repoInfo: { owner: string; repo: string } | null = null;

  if (isPR && !isTestMode) {
    try {
      repoInfo = await git.getRepoInfo();
    } catch (error) {
      console.warn(
        `⚠️ Could not resolve GitHub repo info for link formatting: ${String(error)}`,
      );
    }
  }

  function formatFileLink(
    file: string | undefined,
    line: number | null,
  ): string {
    if (!file) return 'multiple';

    const fileWithLine = line ? `${file}:${line}` : file;

    if (isLocal || isTestMode) {
      const lineFragment = line ? `#L${line}` : '';
      return `[${fileWithLine}](/${file}${lineFragment})`;
    }

    if (isPR && repoInfo) {
      const githubUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/blob/refs/heads/${headRefName}/${file}`;
      const lineFragment = line ? `#L${line}` : '';
      return `[${fileWithLine}](${githubUrl}${lineFragment})`;
    }

    return `\`${fileWithLine}\``;
  }

  const criticalIssues = issues.filter(
    (issue) => issue.category === 'critical',
  );
  const possibleProblems = issues.filter(
    (issue) => issue.category === 'possible',
  );
  const suggestions = issues.filter((issue) => issue.category === 'suggestion');
  const stats = getIssueStats(issues);

  let reviewContent = '';

  if (isLocal || isTestMode) {
    const commitHash = await runCmdSilentUnwrap(['git', 'rev-parse', 'HEAD']);
    const prLink =
      isPR && repoInfo ?
        `PR [#${context.prNumber} - ${headRefName}](https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/${context.prNumber})`
      : isPR ? `PR #${context.prNumber} - ${headRefName}`
      : `branch ${headRefName}`;
    reviewContent += `Review of ${prLink} at ${new Date().toLocaleDateString()} - commit ${commitHash.trim()}\n\n`;
  }

  reviewContent += `
## 📋 Review Summary

${summary}

## 📊 Findings Snapshot

- Total findings: ${stats.total}
- Impacted files: ${stats.impactedFilesCount}
- ${formatIssueSummaryLine('🔴', 'Critical', stats.critical)}
- ${formatIssueSummaryLine('🟠', 'Possible', stats.possible)}
- ${formatIssueSummaryLine('🟡', 'Suggestions', stats.suggestion)}

## 🎯 Specific Feedback
`;

  if (stats.total === 0) {
    reviewContent += '\nNo issues identified in this review.\n';
  }

  function addIssue(issue: ReviewIssue, issueId: string) {
    const { description, files, currentCode, suggestedFix } = issue;

    reviewContent += `\n#### ${issueId}\n\n`;

    if (files.length === 0) {
      reviewContent += `${description}\n`;
    } else if (files.length === 1) {
      const file = files[0];
      if (file) {
        reviewContent += `**File:** ${formatFileLink(file.path, file.line)}\n\n${description}\n`;
      }
    } else {
      reviewContent += `**Files:** ${files.map((f) => formatFileLink(f.path, f.line)).join(', ')}\n\n${description}\n`;
    }

    const extension = files[0] ? getExtensionFromFileName(files[0].path) : '';

    if (currentCode) {
      reviewContent += `\n**Current Code:**\n\n${getCodeBlock(currentCode, extension)}\n`;
    }

    if (suggestedFix) {
      reviewContent += `\n**Suggested Fix:**\n\n${stripMarkdownHeadings(suggestedFix)}\n`;
    }

    if (isPR && context.mode === 'gh-actions') {
      reviewContent += `
<details>
<summary>🔧 Copy-Paste Fix Prompt</summary>

${getIssueCopyPastePrompt(issue)}

</details>
`;
    }

    reviewContent += '\n---\n';
  }

  if (criticalIssues.length > 0) {
    reviewContent += `
### 🔴 Critical Problems (${criticalIssues.length})

@${prAuthor} these issues have a high probability of causing bugs or security vulnerabilities:
`;
    for (const [index, issue] of criticalIssues.entries()) {
      addIssue(issue, `C${index + 1}`);
    }
  }

  if (possibleProblems.length > 0) {
    reviewContent += `
### 🟠 Possible Problems (${possibleProblems.length})

Issues that might cause problems or reduce maintainability, and should be carefully considered:
`;
    for (const [index, issue] of possibleProblems.entries()) {
      addIssue(issue, `P${index + 1}`);
    }
  }

  if (suggestions.length > 0) {
    reviewContent += `
### 🟡 Suggestions (${suggestions.length})

Minor improvements that could enhance code quality (e.g., renames, refactorings):
`;
    for (const [index, issue] of suggestions.entries()) {
      addIssue(issue, `S${index + 1}`);
    }
  }

  reviewContent += `
${EXTRA_DETAILS_MARKER}

### Stats

<details>
<summary>🤖 Token Usage Details</summary>

${formatTokenUsageSection(tokenUsage.reviews, tokenUsage.validatorUsage, tokenUsage.validatorProviderOptions)}
</details>
`;

  return normalizeMarkdownSpacing(reviewContent);
}

export async function handleOutput(
  context: ReviewContext,
  reviewContent: string,
  outputFilePath?: string,
): Promise<void> {
  if (process.env.GITHUB_STEP_SUMMARY && reviewContent) {
    try {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, reviewContent);
      console.log('✅ Review written to GitHub Step Summary');
    } catch (error) {
      console.warn('⚠️ Failed to write GitHub Step Summary:', error);
    }
  }

  const resolvedOutputFilePath =
    outputFilePath ??
    (context.type === 'pr' && context.mode === 'test' ?
      'pr-review-test.md'
    : 'pr-review.md');
  const displayPath =
    resolvedOutputFilePath.startsWith('/') ?
      resolvedOutputFilePath
    : `/${resolvedOutputFilePath}`;

  if (context.type === 'pr' && context.mode === 'gh-actions') {
    console.log('💬 Posting review...');
    await github.createPRComment(
      context.prNumber,
      reviewContent,
      PR_REVIEW_MARKER,
    );
    console.log('✅ Done');
  } else if (context.type === 'pr' && context.mode === 'test') {
    console.log(
      `💬 Review saved to ${styleText(['bold', 'bgBlue'], displayPath)}`,
    );
  } else {
    console.log(
      `💬 Review saved to ${styleText(['bold', 'bgBlue'], displayPath)}`,
    );
  }
}

export function logTokenUsageBreakdown(
  reviewsUsage: TokenUsage,
  validatorUsage: TokenUsage,
): void {
  console.log('📊 Usage breakdown:');
  console.log(
    `   Reviewers: ${formatNum(reviewsUsage.totalTokens)} tokens (${formatNum(reviewsUsage.promptTokens)}+${formatNum(reviewsUsage.completionTokens)})`,
  );

  console.log(
    `   Validator: ${formatNum(validatorUsage.totalTokens)} tokens (${formatNum(validatorUsage.promptTokens)}+${formatNum(validatorUsage.completionTokens)})`,
  );
}
