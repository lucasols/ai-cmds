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

export async function getRemoteBranches(): Promise<string[]> {
  const output = await runCmdSilentUnwrap([
    'git',
    'branch',
    '--remotes',
    '--format=%(refname:short)',
  ]);

  const prefix = 'origin/';

  return output
    .trim()
    .split('\n')
    .filter((ref) => ref.startsWith(prefix) && ref !== 'origin/HEAD')
    .map((ref) => ref.slice(prefix.length))
    .sort((a, b) => a.length - b.length);
}

export async function fetchRemote(): Promise<void> {
  const result = await runCmdSilent(['git', 'fetch', 'origin', '--prune']);

  if (result.error) {
    throw new Error(result.stderr || 'Failed to fetch origin');
  }
}

export type BaseBranchCandidate = {
  branch: string;
  /** Number of commits on HEAD that are not reachable from the candidate branch */
  distance: number;
  /**
   * True when the branch was already merged: its tip is a strict ancestor of
   * another candidate's tip, or it was the head of a merged PR. Fast-forward
   * and rebase merges leave the merged branch at the same distance as its
   * target, so this is what breaks that tie.
   */
  alreadyMerged?: boolean;
};

export type FindClosestBaseBranchOptions = {
  /**
   * Called with branches tied for the smallest distance that git alone cannot
   * tell apart (e.g. identical tips after a fast-forward merge). Returns the
   * subset that should be skipped, such as heads of merged PRs.
   */
  resolveTiedBranches?: (branches: string[]) => Promise<string[]>;
};

const PREFERRED_BASE_BRANCHES = ['main', 'master', 'develop', 'dev'];

function preferredBaseBranchIndex(branch: string): number {
  const index = PREFERRED_BASE_BRANCHES.indexOf(branch);
  return index === -1 ? PREFERRED_BASE_BRANCHES.length : index;
}

/**
 * Picks the most likely base branch: the candidate with the fewest commits
 * between its merge-base and HEAD. Candidates that already contain HEAD
 * (distance 0) are descendants or equal to the current branch and are skipped,
 * as are branches already merged into another candidate. Ties are broken by
 * well-known base names, then by shorter branch names.
 */
export function pickClosestBaseBranch(
  candidates: BaseBranchCandidate[],
): BaseBranchCandidate | null {
  const sorted = candidates
    .filter((candidate) => candidate.distance > 0 && !candidate.alreadyMerged)
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

/**
 * Finds the closest base branch among the remote-tracking branches of
 * `origin`, since the PR base is the remote branch. Returns the branch name
 * without the `origin/` prefix.
 */
export async function findClosestBaseBranch(
  currentBranch: string,
  options: FindClosestBaseBranchOptions = {},
): Promise<BaseBranchCandidate | null> {
  const branches = await getRemoteBranches();
  const candidates: BaseBranchCandidate[] = [];

  for (const branch of branches) {
    if (branch === currentBranch) continue;

    const result = await runCmdSilent([
      'git',
      'rev-list',
      '--count',
      `origin/${branch}..HEAD`,
    ]);

    if (result.error) continue;

    const distance = Number.parseInt(result.stdout.trim(), 10);

    if (Number.isNaN(distance)) continue;

    candidates.push({ branch, distance });
  }

  await markAlreadyMergedTiedCandidates(candidates, options);

  return pickClosestBaseBranch(candidates);
}

/**
 * A branch contained in another candidate can never be strictly closer to
 * HEAD than that candidate, so merged branches only matter when they tie for
 * the smallest distance. Flags those so the branch they were merged into wins.
 */
async function markAlreadyMergedTiedCandidates(
  candidates: BaseBranchCandidate[],
  options: FindClosestBaseBranchOptions,
): Promise<void> {
  const distances = candidates
    .filter((candidate) => candidate.distance > 0)
    .map((candidate) => candidate.distance);

  if (distances.length === 0) return;

  const minDistance = Math.min(...distances);
  const tied = candidates.filter(
    (candidate) => candidate.distance === minDistance,
  );

  if (tied.length < 2) return;

  const tipsResult = await runCmdSilent([
    'git',
    'rev-parse',
    ...tied.map((candidate) => `origin/${candidate.branch}`),
  ]);

  if (tipsResult.error) return;

  const tips = tipsResult.stdout.trim().split('\n');

  if (tips.length !== tied.length) return;

  const tipByBranch = new Map(
    tied.map((candidate, index) => [candidate.branch, tips[index]]),
  );

  for (const candidate of tied) {
    const containingResult = await runCmdSilent([
      'git',
      'branch',
      '--remotes',
      '--contains',
      `origin/${candidate.branch}`,
      '--format=%(refname:short)',
    ]);

    if (containingResult.error) continue;

    const containingBranches = new Set(
      containingResult.stdout.trim().split('\n').filter(Boolean),
    );

    const candidateTip = tipByBranch.get(candidate.branch);

    candidate.alreadyMerged = tied.some(
      (other) =>
        other.branch !== candidate.branch &&
        tipByBranch.get(other.branch) !== candidateTip &&
        containingBranches.has(`origin/${other.branch}`),
    );
  }

  const stillTied = tied.filter((candidate) => !candidate.alreadyMerged);

  if (stillTied.length < 2 || !options.resolveTiedBranches) return;

  const toSkip = new Set(
    await options.resolveTiedBranches(
      stillTied.map((candidate) => candidate.branch),
    ),
  );

  for (const candidate of stillTied) {
    if (toSkip.has(candidate.branch)) candidate.alreadyMerged = true;
  }
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
  getRemoteBranches,
  fetchRemote,
  findClosestBaseBranch,
  stageAll,
  commit,
  hasChanges,
};
