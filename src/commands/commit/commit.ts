import { cliInput, createCmd } from '@ls-stack/cli';
import { estimateTokenCount, sliceByTokens } from 'tokenx';
import { loadConfig } from '../../lib/config.ts';
import { git } from '../../lib/git.ts';
import { showErrorAndExit } from '../../lib/shell.ts';
import { applyExcludePatterns } from '../shared/diff-utils.ts';
import { generateCommitMessage } from './commit-message-generator.ts';

const DEFAULT_MAX_DIFF_TOKENS = 10000;

const DEFAULT_EXCLUDE_PATTERNS = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
];

function truncateDiff(diff: string, maxTokens: number): string {
  const tokenCount = estimateTokenCount(diff);

  if (tokenCount <= maxTokens) {
    return diff;
  }

  const truncated = sliceByTokens(diff, 0, maxTokens);
  return `${truncated}\n\n... (diff truncated, ${tokenCount - maxTokens} tokens omitted)`;
}

export const commitCommand = createCmd({
  description:
    'Generate an AI-powered commit message and commit staged changes',
  short: 'c',
  args: {
    dryRun: {
      type: 'flag',
      name: 'dry-run',
      description: 'Preview generated message without committing',
    },
  },
  examples: [
    { args: [], description: 'Generate commit message and commit' },
    {
      args: ['--dry-run'],
      description: 'Preview commit message without committing',
    },
  ],
  run: async ({ dryRun }) => {
    const rootConfig = await loadConfig();
    const config = rootConfig.commit ?? {};

    const hasAnyChanges = await git.hasChanges();
    if (!hasAnyChanges) {
      showErrorAndExit('No changes to commit.');
    }

    let stagedFiles = await git.getStagedFiles();

    if (stagedFiles.length === 0) {
      console.log('📂 No staged changes found. Staging all changes...');
      await git.stageAll();
      stagedFiles = await git.getStagedFiles();

      if (stagedFiles.length === 0) {
        showErrorAndExit('No changes to commit after staging.');
      }
    }

    console.log(`\n📊 ${stagedFiles.length} file(s) staged for commit\n`);

    const excludePatterns = [
      ...DEFAULT_EXCLUDE_PATTERNS,
      ...(config.excludePatterns ?? []),
    ];
    const filteredFiles = applyExcludePatterns(stagedFiles, excludePatterns);

    const diff = await git.getStagedDiff({
      includeFiles: filteredFiles.length > 0 ? filteredFiles : undefined,
      silent: true,
    });

    if (!diff.trim()) {
      showErrorAndExit(
        'No diff content available. All changes may be in excluded files.',
      );
    }

    const maxTokens = config.maxDiffTokens ?? DEFAULT_MAX_DIFF_TOKENS;
    const truncatedDiff = truncateDiff(diff, maxTokens);

    let message = await generateCommitMessage(truncatedDiff, config);

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const separator = '─'.repeat(60);
      console.log(`\n${separator}`);
      console.log(message);
      console.log(separator);

      if (dryRun) {
        console.log('\n🔍 Dry run mode — commit not created.\n');
        return;
      }

      const action = await cliInput.select('What would you like to do?', {
        options: [
          { value: 'commit', label: 'Commit' },
          { value: 'edit', label: 'Edit message' },
          { value: 'regenerate', label: 'Regenerate' },
          { value: 'cancel', label: 'Cancel' },
        ],
      });

      if (action === 'cancel') {
        console.log('\n🚫 Commit cancelled.\n');
        return;
      }

      if (action === 'edit') {
        message = await cliInput.text('Edit commit message:', {
          initial: message,
        });
        continue;
      }

      if (action === 'regenerate') {
        message = await generateCommitMessage(truncatedDiff, config);
        continue;
      }

      // action === 'commit'
      await git.commit(message);
      console.log('\n✅ Changes committed successfully.\n');
      return;
    }
  },
});
