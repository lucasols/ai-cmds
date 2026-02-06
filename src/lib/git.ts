import { execSync } from 'child_process';
import { runCmdSilentUnwrap, runCmdUnwrap } from './shell.ts';

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

  return runCmdUnwrap(gitArgs, { silent });
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

  return runCmdUnwrap(gitArgs, { silent });
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
  await runCmdUnwrap(['git', 'fetch', 'origin', `${branch}:${branch}`], {
    silent: true,
  });
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

export async function getRepoInfo(): Promise<{ owner: string; repo: string }> {
  const remoteUrl = await getRemoteUrl();

  // Handle both SSH and HTTPS formats
  // SSH: git@github.com:owner/repo.git
  // HTTPS: https://github.com/owner/repo.git
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  const httpsMatch = remoteUrl.match(
    /https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
  );

  const match = sshMatch ?? httpsMatch;

  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `Could not parse GitHub repo from remote URL: ${remoteUrl}`,
    );
  }

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
  };
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

  return runCmdUnwrap(gitArgs, { silent });
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
  await runCmdUnwrap(['git', 'add', '-A'], { silent: true });
}

export async function commit(message: string): Promise<string> {
  return runCmdUnwrap(['git', 'commit', '-m', message], { silent: true });
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
  stageAll,
  commit,
  hasChanges,
};
