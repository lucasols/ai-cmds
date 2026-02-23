import path from 'path';
import { estimateTokenCount } from 'tokenx';
import type { ReviewCodeChangesConfig } from '../../lib/config.ts';
import { formatNum, removeImportOnlyChangesFromDiff } from '../../lib/diff.ts';
import { git } from '../../lib/git.ts';

/**
 * Gets the diff for the selected files.
 */
export async function getDiffForFiles(
  files: string[],
  options: {
    baseBranch: string;
    excludeFiles?: string[];
    useStaged: boolean;
  },
): Promise<string> {
  const { baseBranch, excludeFiles, useStaged } = options;

  if (useStaged) {
    const rawDiff = await git.getStagedDiff({
      includeFiles: files,
      ignoreFiles: excludeFiles,
      silent: true,
    });

    const prDiff = removeImportOnlyChangesFromDiff(rawDiff);

    console.log(
      `📝 Staged diff: ${prDiff.split('\n').length} lines, ${formatNum(estimateTokenCount(prDiff))} tokens`,
    );

    return prDiff;
  }

  const rawDiff = await git.getDiffToBranch(baseBranch, {
    includeFiles: files,
    ignoreFiles: excludeFiles,
    silent: true,
  });

  const prDiff = removeImportOnlyChangesFromDiff(rawDiff);

  console.log(
    `📝 Diff: ${Math.round(prDiff.length / 1024)}KB, ${prDiff.split('\n').length} lines, ${formatNum(estimateTokenCount(prDiff))} tokens`,
  );

  return prDiff;
}

/**
 * Applies exclude patterns to a file list.
 */
export function applyExcludePatterns(
  files: string[],
  excludePatterns?: string[],
): string[] {
  if (!excludePatterns || excludePatterns.length === 0) {
    return files;
  }

  return files.filter(
    (file) =>
      !excludePatterns.some((pattern) => path.matchesGlob(file, pattern)),
  );
}

/**
 * Progressively filters files to reduce diff size below the token limit.
 * Applies compactor steps in order until the diff fits or all steps are exhausted.
 */
export async function compactDiff(
  changedFiles: string[],
  diff: string,
  diffOptions: {
    baseBranch: string;
    excludeFiles?: string[];
    useStaged: boolean;
  },
  maxDiffTokens: number,
  steps: NonNullable<ReviewCodeChangesConfig['diffCompactor']>,
): Promise<{ files: string[]; diff: string; ignoreAgentsMd: boolean }> {
  let currentTokens = estimateTokenCount(diff);

  if (currentTokens <= maxDiffTokens) {
    return { files: changedFiles, diff, ignoreAgentsMd: false };
  }

  let currentFiles = changedFiles;
  let currentDiff = diff;
  let ignoreAgentsMd = false;

  for (const step of steps) {
    console.log(
      `🗜️ Diff too large (${formatNum(currentTokens)} tokens > ${formatNum(maxDiffTokens)}), applying compactor step: "${step.name}"`,
    );

    const filteredFiles = await step.filterFiles(currentFiles);

    if (filteredFiles.length === 0) {
      console.log(
        `⚠️ Compactor step "${step.name}" filtered out all files, skipping`,
      );
      continue;
    }

    if (filteredFiles.length === currentFiles.length) {
      console.log(
        `ℹ️ Compactor step "${step.name}" did not filter any files, skipping`,
      );
      continue;
    }

    currentDiff = await getDiffForFiles(filteredFiles, diffOptions);
    currentFiles = filteredFiles;
    currentTokens = estimateTokenCount(currentDiff);

    if (step.ignoreAgentsMd) {
      ignoreAgentsMd = true;
    }

    console.log(
      `📂 After "${step.name}": ${currentFiles.length} files, ${formatNum(currentTokens)} tokens`,
    );

    if (currentTokens <= maxDiffTokens) {
      break;
    }
  }

  return { files: currentFiles, diff: currentDiff, ignoreAgentsMd };
}
