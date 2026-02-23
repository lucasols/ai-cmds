import { dedent } from '@ls-stack/utils/dedent';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { estimateTokenCount } from 'tokenx';
import { formatNum } from '../../lib/diff.ts';
import { git } from '../../lib/git.ts';
import type {
  GeneralPRComment,
  IndividualReview,
  PRData,
  PRReviewContext,
  ReviewContext,
} from './types.ts';

const loggedMessages = new Set<string>();

function logOnce(message: string): void {
  if (loggedMessages.has(message)) return;
  loggedMessages.add(message);
  console.log(message);
}

function warnOnce(message: string): void {
  if (loggedMessages.has(message)) return;
  loggedMessages.add(message);
  console.warn(message);
}

const CODE_FENCE = '```';

export type ReviewInstructionOptions = {
  reviewInstructionsPath?: string | false;
  includeDefaultReviewInstructions?: boolean;
  customReviewInstruction?: string;
};

export type ReviewPromptOptions = ReviewInstructionOptions & {
  includeAgentsFileInReviewPrompt?: boolean;
};

const defaultReviewInstructions = dedent`
  # Code Review Instructions

  ## Review Philosophy

  Focus on issues that actually matter and will affect the application:

  1. **Trust the tooling** - Don't flag TypeScript type errors (the compiler catches those) or ESLint issues (the linter catches those)
  2. **Focus on logic and semantics** - Look for bugs, incorrect logic, missing validation, security issues
  3. **Be specific** - Every issue should point to specific code and explain why it's a problem
  4. **Don't flag style issues** - Code formatting, naming conventions, etc. are handled by tooling
  5. **Don't suggest documentation** - Comments and docs are subjective and not required

  ## What to Look For

  ### Critical Issues (🔴)
  - Security vulnerabilities (SQL injection, XSS, auth bypass, etc.)
  - Data corruption or loss
  - Race conditions
  - Memory leaks
  - Unhandled edge cases that will cause crashes

  ### Possible Problems (🟠)
  - Logic errors that might cause incorrect behavior
  - Missing error handling for likely failure scenarios
  - Performance issues with obvious impact
  - Inconsistent state handling

  ### Suggestions (🟡)
  - Confusing or overly complex logic that could be simplified
  - Minor improvements that would make code more maintainable
  - Better variable/function names that clarify intent

  ## What NOT to Flag

  - Missing comments or documentation
  - Code style preferences (let vs const, arrow vs regular functions, etc.)
  - Type annotations (TypeScript handles this)
  - Import organization
  - File structure opinions
  - "Best practices" that don't have concrete impact
  - Premature optimization suggestions
  - Framework-specific patterns the team may intentionally avoid
`;

export function stripYamlFrontmatter(content: string): string {
  if (!content.startsWith('---')) {
    return content;
  }
  const closingIndex = content.indexOf('\n---', 3);
  if (closingIndex === -1) {
    return content;
  }
  return content.slice(closingIndex + 4).trimStart();
}

const REVIEW_INSTRUCTIONS_FALLBACK_PATHS = [
  '.agents/CODE_REVIEW.md',
  '.agents/skills/code-review/SKILL.md',
] as const;

function tryReadFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    warnOnce(`Warning: Could not read file ${filePath}`);
    return undefined;
  }
}

function getReviewInstructions(customPath?: string | false): string {
  if (customPath === false) {
    return defaultReviewInstructions;
  }

  if (customPath) {
    const content = tryReadFile(customPath);
    if (content !== undefined) {
      const stripped = stripYamlFrontmatter(content);
      logOnce(
        `📄 Using review instructions from ${customPath} (${formatNum(estimateTokenCount(stripped))} tokens)`,
      );
      return stripped;
    }
    warnOnce(
      `Warning: Could not read review instructions from ${customPath}, using defaults`,
    );
    return defaultReviewInstructions;
  }

  const gitRoot = git.getGitRoot();
  for (const fallbackPath of REVIEW_INSTRUCTIONS_FALLBACK_PATHS) {
    const fullPath = join(gitRoot, fallbackPath);
    const content = tryReadFile(fullPath);
    if (content !== undefined) {
      const stripped = stripYamlFrontmatter(content);
      logOnce(
        `📄 Using review instructions from ${fallbackPath} (${formatNum(estimateTokenCount(stripped))} tokens)`,
      );
      return stripped;
    }
  }

  return defaultReviewInstructions;
}

function createEffectiveReviewInstructions(
  options: ReviewInstructionOptions = {},
): string {
  const includeDefaultReviewInstructions =
    options.includeDefaultReviewInstructions ?? true;
  const normalizedCustomInstruction = options.customReviewInstruction?.trim();
  const sections: string[] = [];

  if (includeDefaultReviewInstructions) {
    sections.push(getReviewInstructions(options.reviewInstructionsPath));
  }

  if (normalizedCustomInstruction) {
    sections.push(dedent`
      ## Additional Focus

      ${normalizedCustomInstruction}
    `);
  }

  if (sections.length === 0) {
    return dedent`
      # Code Review Instructions

      Focus on concrete, actionable issues with real impact on behavior,
      correctness, security, or maintainability.
    `;
  }

  return sections.join('\n\n');
}

function getAgentsInstructions(includeAgentsFileInReviewPrompt: boolean): {
  path: string;
  content: string;
} | null {
  if (!includeAgentsFileInReviewPrompt) {
    return null;
  }

  const agentsPath = join(git.getGitRoot(), 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    return null;
  }

  try {
    const content = readFileSync(agentsPath, 'utf-8');
    logOnce(
      `📄 Using AGENTS.md from ${agentsPath} (${formatNum(estimateTokenCount(content))} tokens)`,
    );
    return {
      path: agentsPath,
      content,
    };
  } catch {
    warnOnce(
      `Warning: Could not read AGENTS.md from ${agentsPath}, skipping AGENTS instructions`,
    );
    return null;
  }
}

const outputFormat = `
# Code Snippet Guidelines

When providing feedback, always include relevant code snippets to make your comments clear and actionable:

1. **For Critical Issues**: Show the problematic code and provide a concrete fix
2. **For Suggestions**: Show the current implementation to provide context
3. **Use appropriate syntax highlighting** (typescript, javascript, tsx, jsx, etc.)
4. **Include enough context** - show surrounding lines if needed for clarity
5. **Use diff format** when showing before/after changes
6. **Include the code line number** if it's a specific line of code

# Output Format:

Structure your review using this exact format with markdown:

## 📋 Review Summary

Provide a brief 2-3 sentence overview of the PR and overall assessment.

## 🎯 Specific Feedback

Only include sections below that have actual issues. If there are no issues in a priority category, omit that entire section.

### 🔴 Critical Problems (high probability of causing bugs or issues)

(Only include this section if there are critical issues)
Issues that will cause critical bugs or security vulnerabilities:

- **File: \`filename:line\`** - Description of critical issue with the suggested fix
  **Current Code:**

  ${CODE_FENCE}typescript
  // Current code that has the issue
  const example = problematicCode();
  ${CODE_FENCE}

  **Suggested Fix:**

  ${CODE_FENCE}diff
  - problematic code line
  + suggested fix
  ${CODE_FENCE}

<!-- For issues that are not related to specific files, you can use the following format: -->

- Detailed description of the issue and the suggested fix

### 🟠 Possible Problems (should be carefully considered)

(Only include this section if there are high priority issues)
Issues that might cause bugs or problems or reduce maintainability:

- **File: \`filename:line\`** - Description of high priority issue with the suggested fix

  ${CODE_FENCE}typescript
  // Current code that has the issue
  const example = problematicCode();
  ${CODE_FENCE}

  **Suggested Fix:**

  ${CODE_FENCE}diff
  - problematic code line
  + suggested fix
  ${CODE_FENCE}

### 🟡 Suggestions (consider improving)

Minor improvements that could enhance code quality (e.g., renames, refactorings):

- **File: \`filename:line\`** - Description of medium priority improvement

  ${CODE_FENCE}typescript
  // Current code that has the issue
  const example = problematicCode();
  ${CODE_FENCE}

  **Suggested Fix:**

  ${CODE_FENCE}diff
  - problematic code line
  + suggested fix
  ${CODE_FENCE}

# Output guidelines

- Include specific examples of how to fix issues. If no issues are found, state "No issues identified in this review."
`;

function getPromptCacheableData(
  context: ReviewContext,
  prData: PRData | null,
  changedFiles: string[],
  prDiff: string,
) {
  const contextSection =
    prData && context.type === 'pr' ?
      `
<pr_context>
<pr_author>${prData.author.login}</pr_author>
<pr_number>${context.prNumber}</pr_number>
${context.additionalInstructions ? `<additional_instructions>${context.additionalInstructions}</additional_instructions>` : ''}
</pr_context>

<pr_data>
${JSON.stringify(prData, null, 2)}
</pr_data>`
    : `
<review_context>
<branch>${git.getCurrentBranch()}</branch>
${context.additionalInstructions ? `<additional_instructions>${context.additionalInstructions}</additional_instructions>` : ''}
</review_context>`;

  return `
${contextSection}

<changed_files>
${changedFiles.join('\n')}
</changed_files>

<pr_diff format=".diff file" note="Files with import-only changes have been stripped from this diff">
${prDiff}
</pr_diff>
`;
}

export function createReviewPrompt(
  context: ReviewContext,
  prData: PRData | null,
  changedFiles: string[],
  prDiff: string,
  options: ReviewPromptOptions = {},
): { system: string; prompt: string } {
  const reviewInstructions = createEffectiveReviewInstructions(options);
  const agentsInstructions = getAgentsInstructions(
    options.includeAgentsFileInReviewPrompt ?? false,
  );

  const systemCacheableContent = `
<review_instructions format="markdown">
${reviewInstructions}
</review_instructions>

${
  agentsInstructions ?
    `<agents_instructions format="markdown" source="${agentsInstructions.path}">
${agentsInstructions.content}
</agents_instructions>`
  : ''
}
`;

  const system = `${systemCacheableContent}

<role>
You are an expert code reviewer specializing in TypeScript, React, and modern web development practices. Your role is to perform comprehensive code reviews of pull request changes
</role>

<output_format format="markdown">
${outputFormat}
</output_format>

<tools>
Available tools to assist your review:
- **readFile**: Use if you need additional context from files not shown in the diff
- **listDirectory**: Use to explore project structure and understand file organization
- **ripgrep**: Use to search for patterns in files across the codebase (supports regex, respects .gitignore)
</tools>

<task>
Review the changes carefully and write a comprehensive review following the format specified in the <output_format>.

Focus on the code changes shown in the pr_diff and consider the context provided in the pr_data and changed_files.

The <pr_diff> is a file in .diff format. It will not have the full files content, just the changes. Use the readFile tool to get the full file content when the diff is not enough to understand the changes.

IMPORTANT: Files with import-only changes have been stripped from the diff to reduce noise. If a file appears in <changed_files> but not in <pr_diff>, it likely only has import changes that don't need review.

Write your final review directly in your response following the specified format.
</task>
`;

  const prompt = `
${getPromptCacheableData(context, prData, changedFiles, prDiff)}
`;

  return { system, prompt };
}

function formatHumanCommentsForPrompt(
  humanComments: GeneralPRComment[],
): string {
  if (humanComments.length === 0) return '';

  let content = '\n<human_review_feedback>\n';
  content += `<general_discussion count="${humanComments.length}">\n`;

  for (const comment of humanComments) {
    content += `<comment author="${comment.author}" date="${comment.createdAt}">\n`;
    content += `${comment.body}\n`;
    content += '</comment>\n';
  }

  content += '</general_discussion>\n';
  content += '</human_review_feedback>\n';

  return content;
}

export function createValidationPrompt(
  context: ReviewContext,
  reviews: IndividualReview[],
  prData: PRData | null,
  changedFiles: string[],
  prDiff: string,
  humanComments?: GeneralPRComment[],
  options: ReviewInstructionOptions = {},
): { system: string; prompt: string } {
  const reviewInstructions = createEffectiveReviewInstructions(options);

  const systemCacheableContent = `
<review_instructions format="markdown">
${reviewInstructions}
</review_instructions>
`;

  const system = `${systemCacheableContent}

<role>
You are a senior code review validator. Your job is to carefully analyze multiple code reviews and validate their findings.
</role>

<task>
You will receive multiple independent code reviews. Your job is to:

1. **Validate Issues**: Carefully examine each reported issue against the actual code changes
2. **Remove False Positives**: Eliminate issues that are not actually problems
3. **Correct Categorization**: Ensure issues are properly categorized as critical, possible problems, or suggestions
  - Critical issues should be only very critical issues that can heavily affect negatively the functionality of application. If it is not critical, it should be a possible problem.
4. **Check if the issues are following the review instructions**: Issues that do not follow the review instructions should be removed or re-categorized to lower priority.

Available tools:
- **readFile**: Use this to examine actual source code files when validating reported issues
- **listDirectory**: Use to explore project structure and understand file organization
- **ripgrep**: Use to search for patterns in files across the codebase (supports regex, respects .gitignore)

Focus on accuracy - it's better to have fewer, high-quality issues than many false positives.

NOTE: Files with import-only changes have been stripped from the diff to reduce noise. If an issue references a file that only has import changes, it may be a false positive.

<ensure_code_understanding>
DO NOT offer the user hypothetical scenarios based on how the code may behave with the code that are not in the diff.
Fully understand the code (using readFile, ripgrep and listDirectory tools) to understand how the changes will interact with the existing code.

Example:
DO NOT do this: "Depending on how X treats Y...", "Depending on how X implements Y..."
Check how the X properly works and handle the affected changes to offer a precise feedback.
</ensure_code_understanding>

Consider general discussion comments for additional context about the PR.

Write your final output as structured JSON only, matching this shape:

<output_format format="json">
{
  "summary": "string",
  "issues": [
    {
      "category": "critical | possible | suggestion | not-applicable-or-false-positive",
      "files": [
        {
          "path": "string",
          "line": "number | null"
        }
      ],
      "description": "string",
      "currentCode": "string | null",
      "suggestedFix": "string | null"
    }
  ]
}
</output_format>

Rules:
- Return ONLY the JSON object. Do not include markdown.
- Keep only actionable issues. Use not-applicable-or-false-positive for items that should be discarded.
- Preserve code indentation inside currentCode and suggestedFix when provided.
</task>`;

  const allReviews = reviews
    .filter((review) => review.usage.totalTokens > 0)
    .map(
      (review) =>
        `## Review from Reviewer #${review.reviewerId}

${review.content}
`,
    )
    .join('\n\n---\n\n');

  const humanFeedback =
    humanComments ? formatHumanCommentsForPrompt(humanComments) : '';

  const prompt = `
${getPromptCacheableData(context, prData, changedFiles, prDiff)}

${humanFeedback}

<all_reviews>
${allReviews}
</all_reviews>
`;

  return { system, prompt };
}

export function createPreviousReviewCheckPrompt(
  context: PRReviewContext,
  prData: PRData | null,
  changedFiles: string[],
  prDiff: string,
  previousIssues: string,
  options: ReviewInstructionOptions = {},
): { system: string; prompt: string } {
  const reviewInstructions = createEffectiveReviewInstructions(options);

  const system = dedent`
    <review_instructions format="markdown">
    ${reviewInstructions}
    </review_instructions>

    <role>
    You are an expert code reviewer verifying if previously identified issues have been fixed in the latest code changes.
    </role>

    <tools>
    Available tools to assist your review:
    - **readFile**: Use to examine the current state of files to verify if issues are fixed
    - **listDirectory**: Use to explore project structure and understand file organization
    - **ripgrep**: Use to search for patterns in files across the codebase (supports regex, respects .gitignore)
    </tools>

    <task>
    You are reviewing a PR that has already been reviewed before. The previous review found some issues.

    Your job is to:
    1. Check each previously identified issue against the CURRENT code
    2. Only report issues that are STILL PRESENT in the code
    3. If an issue has been fixed, DO NOT mention it at all
    4. Use the same output format (🔴 Critical, 🟠 Possible Problems, 🟡 Suggestions)
    5. If ALL issues have been fixed, respond with exactly: "No issues found."

    IMPORTANT:
    - Use the readFile tool to verify the current state of the code
    - Focus on the specific issues mentioned in the previous review
    - Do not look for new issues - only verify if the previous issues are still present
    - Be thorough: read the actual files to confirm whether each issue was addressed
    </task>

    <output_format format="markdown">
    ${outputFormat}
    </output_format>
  `;

  const promptCacheableData = getPromptCacheableData(
    context,
    prData,
    changedFiles,
    prDiff,
  );

  const prompt = dedent`
    ${promptCacheableData}

    <previous_review_issues>
    ${previousIssues}
    </previous_review_issues>

    Please verify if these previously identified issues are still present in the current code.
    Use the readFile tool to check the actual file contents before making your determination.
  `;

  return { system, prompt };
}
