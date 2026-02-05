import { writeFile } from 'fs/promises';
import { styleText } from 'util';
import { git } from '../../lib/git.ts';
import { github } from '../../lib/github.ts';
import { runCmdSilentUnwrap } from '../../lib/shell.ts';
import type {
  ReviewContext,
  IndividualReview,
  ValidatedReview,
  TokenUsage,
  ReviewIssue,
} from './types.ts';

export const EXTRA_DETAILS_MARKER = '<!-- EXTRA_DETAILS -->';
export const PR_REVIEW_MARKER = 'AI_CLI_PR_REVIEW';

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
    model: models.join(', '),
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

function formatTokenUsageSection(
  reviews: IndividualReview[],
  validatorUsage: TokenUsage,
  formatterUsage: TokenUsage,
): string {
  let content = '';

  const totalUsage = calculateTotalUsage([
    ...reviews.map((review) => review.usage),
    validatorUsage,
    formatterUsage,
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
    content += `- Input Tokens: ${formatNum(review.usage.promptTokens || 0)}\n`;
    content += `- Output Tokens: ${formatNum(review.usage.completionTokens || 0)}\n`;
    content += `- Total Tokens: ${formatNum(review.usage.totalTokens || 0)}\n`;
    content += `- Reasoning Tokens: ${formatNum(review.usage.reasoningTokens || 0)}\n`;
    content += '\n';
  }

  content += '**Validator:**\n';
  content += `- Model: ${validatorUsage.model}\n`;
  content += `- Input Tokens: ${formatNum(validatorUsage.promptTokens)}\n`;
  content += `- Output Tokens: ${formatNum(validatorUsage.completionTokens)}\n`;
  content += `- Total Tokens: ${formatNum(validatorUsage.totalTokens)}\n`;
  content += `- Reasoning Tokens: ${formatNum(validatorUsage.reasoningTokens || 0)}\n`;
  content += '\n';

  content += '**Final Review Formatter:**\n';
  content += `- Model: ${formatterUsage.model}\n`;
  content += `- Input Tokens: ${formatNum(formatterUsage.promptTokens)}\n`;
  content += `- Output Tokens: ${formatNum(formatterUsage.completionTokens)}\n`;
  content += `- Total Tokens: ${formatNum(formatterUsage.totalTokens)}\n`;
  content += `- Reasoning Tokens: ${formatNum(formatterUsage.reasoningTokens || 0)}\n`;
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
  return `\`\`\`${extension || ''}\n${code}\n\`\`\`\n\n`;
}

function stripMarkdownHeadings(markdown: string): string {
  return markdown.replace(/^#{1,6}\s+/gm, '');
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

export async function formatValidatedReview(
  validatedReview: ValidatedReview,
  prAuthor: string,
  context: ReviewContext,
  headRefName: string,
  tokenUsage: {
    reviews: IndividualReview[];
    validatorUsage: TokenUsage;
    formatterUsage: TokenUsage;
  },
): Promise<string> {
  const { summary, issues } = validatedReview;
  const { owner, repo } = await git.getRepoInfo();

  const isLocal = context.type === 'local';
  const isPR = context.type === 'pr';
  const isTestMode = isPR && context.mode === 'test';

  function formatFileLink(
    file: string | undefined,
    line: number | null,
  ): string {
    if (!file) return 'multiple';

    const fileWithLine = line ? `${file}:${line}` : file;

    if (isLocal || isTestMode) {
      const lineFragment = line ? `#L${line}` : '';
      return `[${fileWithLine}](/${file}${lineFragment})`;
    } else if (isPR) {
      const githubUrl = `https://github.com/${owner}/${repo}/blob/refs/heads/${headRefName}/${file}`;
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

  let reviewContent = '';

  if (isLocal || isTestMode) {
    const commitHash = await runCmdSilentUnwrap(['git', 'rev-parse', 'HEAD']);
    const prLink =
      isPR ?
        `PR [#${context.prNumber} - ${headRefName}](https://github.com/${owner}/${repo}/pull/${context.prNumber})`
      : `branch ${headRefName}`;
    reviewContent += `
Review of ${prLink} at ${new Date().toLocaleDateString()} - in commit ${commitHash.trim()}
`;
  }

  reviewContent += `
## 📋 Review Summary

${summary}

## 🎯 Specific Feedback

`;

  if (
    criticalIssues.length === 0 &&
    possibleProblems.length === 0 &&
    suggestions.length === 0
  ) {
    reviewContent += 'No issues identified in this review.\n';
  }

  function addIssue(issue: ReviewIssue, index: number) {
    const { description, files, currentCode, suggestedFix } = issue;

    reviewContent += `#### Problem ${index + 1}`;
    reviewContent += '\n\n';

    if (files.length === 0) {
      reviewContent += `${description}\n`;
    } else if (files.length === 1) {
      const file = files[0];
      if (file) {
        reviewContent += `**File: ${formatFileLink(file.path, file.line)}** - ${description}\n`;
      }
    } else {
      reviewContent += `**Files: ${files.map((f) => formatFileLink(f.path, f.line)).join(', ')}** - ${description}\n`;
    }

    const extension = files[0] ? getExtensionFromFileName(files[0].path) : '';

    if (currentCode) {
      reviewContent += `
**Current Code:**

${getCodeBlock(currentCode, extension)}
`;
      reviewContent += '\n\n';
    }

    if (suggestedFix) {
      reviewContent += `
**Suggested Fix:**

${stripMarkdownHeadings(suggestedFix)}
`;
    }

    if (isPR && context.mode === 'gh-actions') {
      reviewContent += `
<details>
<summary>🔧 Copy-Paste Fix Prompt</summary>

${getIssueCopyPastePrompt(issue)}

</details>
`;
    }

    reviewContent += '\n\n---\n\n';
  }

  let index = 0;

  if (criticalIssues.length > 0) {
    reviewContent += `
### 🔴 Critical Problems

@${prAuthor} these issues have a high probability of causing bugs or security vulnerabilities:

`;

    for (const issue of criticalIssues) {
      addIssue(issue, index++);
    }

    reviewContent += '\n\n';
  }

  if (possibleProblems.length > 0) {
    reviewContent += `
### 🟠 Possible Problems

Issues that might cause problems or reduce maintainability, and should be carefully considered:

`;

    for (const issue of possibleProblems) {
      addIssue(issue, index++);
    }

    reviewContent += '\n\n';
  }

  if (suggestions.length > 0) {
    reviewContent += `
### 🟡 Suggestions

Minor improvements that could enhance code quality (e.g., renames, refactorings):

`;

    for (const issue of suggestions) {
      addIssue(issue, index++);
    }

    reviewContent += '\n\n';
  }

  reviewContent += `

${EXTRA_DETAILS_MARKER}

### Stats

<details>
<summary>🤖 Token Usage Details</summary>

${formatTokenUsageSection(
  tokenUsage.reviews,
  tokenUsage.validatorUsage,
  tokenUsage.formatterUsage,
)}
</details>
`;

  reviewContent += '\n\n';

  reviewContent = reviewContent
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  reviewContent = reviewContent.replace(/\n{3,}/g, '\n\n');

  return reviewContent;
}

export async function handleOutput(
  context: ReviewContext,
  reviewContent: string,
): Promise<void> {
  if (process.env.GITHUB_STEP_SUMMARY && reviewContent) {
    try {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, reviewContent);
      console.log('✅ Review written to GitHub Step Summary');
    } catch (error) {
      console.warn('⚠️ Failed to write GitHub Step Summary:', error);
    }
  }

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
      `💬 Review saved to ${styleText(['bold', 'bgBlue'], '/pr-review-test.md')}`,
    );
  } else {
    console.log(
      `💬 Review saved to ${styleText(['bold', 'bgBlue'], '/pr-review.md')}`,
    );
  }
}

export function logTokenUsageBreakdown(
  reviewsUsage: TokenUsage,
  validatorUsage: TokenUsage,
  formatterUsage: TokenUsage,
): void {
  console.log('📊 Usage breakdown:');
  console.log(
    `   Reviewers: ${formatNum(reviewsUsage.totalTokens)} tokens (${formatNum(reviewsUsage.promptTokens)}+${formatNum(reviewsUsage.completionTokens)})`,
  );

  console.log(
    `   Validator: ${formatNum(validatorUsage.totalTokens)} tokens (${formatNum(validatorUsage.promptTokens)}+${formatNum(validatorUsage.completionTokens)})`,
  );

  console.log(
    `   Final Review Formatter: ${formatNum(formatterUsage.totalTokens)} tokens (${formatNum(formatterUsage.promptTokens)}+${formatNum(formatterUsage.completionTokens)})`,
  );
}
