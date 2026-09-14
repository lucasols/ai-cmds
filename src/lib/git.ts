import { execSync } from 'child_process';
import {
  runCmd,
  runCmdSilent,
  runCmdSilentUnwrap,
  runCmdUnwrap,
} from '@ls-stack/node-utils/runShellCmd';

export function getCurrentBranch(): string {
  return execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
}

export function getGitRoot(): string {
  return execSync('git rev-parse --show-toplevel').toString().trim();
}

export async function getDiffToBranch(
  baseBranch: string,
  options: {
    ignoreFiles?: string[];
    includeFiles?: string[];
    silent?: boolean;
  } = {},
): Promise<string> {
  const { ignoreFiles, includeFiles, silent = true } = options;

  const gitArgs = ['git', 'diff', `${baseBranch}...HEAD`];

  const hasIncludeFiles = includeFiles && includeFiles.length > 0;
  const hasIgnoreFiles = ignoreFiles && ignoreFiles.length > 0;

  if (hasIncludeFiles || hasIgnoreFiles) {
    gitArgs.push('--');

    if (hasIncludeFiles) {
      gitArgs.push(...includeFiles);
    }

    if (hasIgnoreFiles) {
      for (const file of ignoreFiles) {
        gitArgs.push(`:(exclude)${file}`);
      }
    }
  }

  return runCmdUnwrap(null, gitArgs, { silent });
}

export async function getStagedDiff(
  options: {
    ignoreFiles?: string[];
    includeFiles?: string[];
    silent?: boolean;
  } = {},
): Promise<string> {
  const { ignoreFiles, includeFiles, silent = true } = options;

  const gitArgs = ['git', 'diff', '--cached'];

  const hasIncludeFiles = includeFiles && includeFiles.length > 0;
  const hasIgnoreFiles = ignoreFiles && ignoreFiles.length > 0;

  if (hasIncludeFiles || hasIgnoreFiles) {
    gitArgs.push('--');

    if (hasIncludeFiles) {
      gitArgs.push(...includeFiles);
    }

    if (hasIgnoreFiles) {
      for (const file of ignoreFiles) {
        gitArgs.push(`:(exclude)${file}`);
      }
    }
  }

  return runCmdUnwrap(null, gitArgs, { silent });
}

export async function getChangedFiles(baseBranch: string): Promise<string[]> {
  const output = await runCmdSilentUnwrap([
    'git',
    'diff',
    '--name-only',
    `origin/${baseBranch}...HEAD`,
  ]);

  return output.trim().split('\n').filter(Boolean);
}

export async function getStagedFiles(): Promise<string[]> {
  const output = await runCmdSilentUnwrap([
    'git',
    'diff',
    '--cached',
    '--name-only',
  ]);

  return output.trim().split('\n').filter(Boolean);
}

export async function fetchBranch(branch: string): Promise<void> {
  const result = await runCmd(
    null,
    ['git', 'fetch', 'origin', `${branch}:${branch}`],
    { silent: true },
  );

  if (result.error) {
    throw new Error(result.stderr || `Failed to fetch branch ${branch}`);
  }
}

export async function getCommitHash(): Promise<string> {
  return runCmdSilentUnwrap(['git', 'rev-parse', 'HEAD']);
}

export async function getRemoteUrl(): Promise<string> {
  return runCmdSilentUnwrap(['git', 'remote', 'get-url', 'origin']);
}

export async function getLocalBranches(): Promise<string[]> {
  const output = await runCmdSilentUnwrap([
    'git',
    'branch',
    '--format=%(refname:short)',
  ]);

  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);
}

export type BaseBranchCandidate = {
  branch: string;
  /** Number of commits on HEAD that are not reachable from the candidate branch */
  distance: number;
};

const PREFERRED_BASE_BRANCHES = ['main', 'master', 'develop', 'dev'];

function preferredBaseBranchIndex(branch: string): number {
  const index = PREFERRED_BASE_BRANCHES.indexOf(branch);
  return index === -1 ? PREFERRED_BASE_BRANCHES.length : index;
}

/**
 * Picks the most likely base branch: the candidate with the fewest commits
 * between its merge-base and HEAD. Candidates that already contain HEAD
 * (distance 0) are descendants or equal to the current branch and are skipped.
 * Ties are broken by well-known base names, then by shorter branch names.
 */
export function pickClosestBaseBranch(
  candidates: BaseBranchCandidate[],
): BaseBranchCandidate | null {
  const sorted = candidates
    .filter((candidate) => candidate.distance > 0)
    .toSorted((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;

      const preferenceDiff =
        preferredBaseBranchIndex(a.branch) - preferredBaseBranchIndex(b.branch);
      if (preferenceDiff !== 0) return preferenceDiff;

      if (a.branch.length !== b.branch.length) {
        return a.branch.length - b.branch.length;
      }

      return a.branch.localeCompare(b.branch);
    });

  return sorted[0] ?? null;
}

export async function findClosestBaseBranch(
  currentBranch: string,
): Promise<BaseBranchCandidate | null> {
  const branches = await getLocalBranches();
  const candidates: BaseBranchCandidate[] = [];

  for (const branch of branches) {
    if (branch === currentBranch) continue;

    const result = await runCmdSilent([
      'git',
      'rev-list',
      '--count',
      `${branch}..HEAD`,
    ]);

    if (result.error) continue;

    const distance = Number.parseInt(result.stdout.trim(), 10);

    if (Number.isNaN(distance)) continue;

    candidates.push({ branch, distance });
  }

  return pickClosestBaseBranch(candidates);
}

export async function getRepoInfo(): Promise<{ owner: string; repo: string }> {
  const result = await runCmd(
    null,
    ['gh', 'repo', 'view', '--json', 'owner,name'],
    { silent: true, noCiColorForce: true },
  );

  if (result.error) {
    throw new Error(result.stderr || 'Failed to get repo info');
  }

  const parsed: unknown = JSON.parse(result.stdout);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('owner' in parsed) ||
    !('name' in parsed)
  ) {
    throw new Error(`Unexpected gh repo view output: ${result.stdout}`);
  }

  const { owner, name } = parsed as { owner: { login: string }; name: string };

  return { owner: owner.login, repo: name };
}

export async function getUnstagedDiff(
  options: {
    includeFiles?: string[];
    silent?: boolean;
  } = {},
): Promise<string> {
  const { includeFiles, silent = true } = options;

  const gitArgs = ['git', 'diff'];

  if (includeFiles && includeFiles.length > 0) {
    gitArgs.push('--', ...includeFiles);
  }

  return runCmdUnwrap(null, gitArgs, { silent });
}

export async function getChangedFilesUnstaged(): Promise<string[]> {
  const modifiedOutput = await runCmdSilentUnwrap([
    'git',
    'diff',
    '--name-only',
  ]);

  const untrackedOutput = await runCmdSilentUnwrap([
    'git',
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);

  return [
    ...modifiedOutput.trim().split('\n'),
    ...untrackedOutput.trim().split('\n'),
  ].filter(Boolean);
}

export async function stageAll(): Promise<void> {
  await runCmdUnwrap(null, ['git', 'add', '-A'], { silent: true });
}

export async function commit(message: string): Promise<string> {
  return runCmdUnwrap(null, ['git', 'commit', '-m', message], { silent: true });
}

export async function hasChanges(): Promise<boolean> {
  const output = await runCmdSilentUnwrap(['git', 'status', '--porcelain']);
  return output.trim().length > 0;
}

export const git = {
  getCurrentBranch,
  getGitRoot,
  getDiffToBranch,
  getStagedDiff,
  getUnstagedDiff,
  getChangedFiles,
  getChangedFilesUnstaged,
  getStagedFiles,
  fetchBranch,
  getCommitHash,
  getRemoteUrl,
  getRepoInfo,
  getLocalBranches,
  findClosestBaseBranch,
  stageAll,
  commit,
  hasChanges,
};
