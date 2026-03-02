import { cliInput, createCmd } from '@ls-stack/cli';
import { loadConfig, resolveBaseBranch } from '../../lib/config.ts';
import { git } from '../../lib/git.ts';
import { github } from '../../lib/github.ts';
import { showErrorAndExit } from '../../lib/shell.ts';
import { applyExcludePatterns } from '../shared/diff-utils.ts';
import {
  detectAvailableProvider,
  generatePRContent,
} from '../create-pr/pr-generator.ts';
import {
  buildPRBody,
  loadTemplate,
  parseTemplate,
} from '../create-pr/template-parser.ts';
import type { GeneratedPRContent } from '../create-pr/types.ts';

const DEFAULT_TEMPLATE_PATH = '.github/pull_request_template.md';

export const syncPRDescriptionCommand = createCmd({
  description: 'Update an existing PR description with AI-generated content',
  short: 'sp',
  args: {
    base: {
      type: 'value-string-flag',
      name: 'base',
      description: 'Base branch for diff comparison',
    },
    dryRun: {
      type: 'flag',
      name: 'dry-run',
      description: 'Preview without updating the PR',
    },
  },
  examples: [
    { args: [], description: 'Sync PR description with latest changes' },
    {
      args: ['--base', 'develop'],
      description: 'Sync using develop as base branch',
    },
    {
      args: ['--dry-run'],
      description: 'Preview updated description without applying',
    },
  ],
  run: async ({ base, dryRun }) => {
    const rootConfig = await loadConfig();
    const config = rootConfig.createPR ?? {};

    const currentBranch = git.getCurrentBranch();

    if (currentBranch === 'main' || currentBranch === 'master') {
      showErrorAndExit(
        `Cannot sync PR description from ${currentBranch} branch. Please checkout a feature branch.`,
      );
    }

    console.log(`\n🔍 Checking PR status for branch: ${currentBranch}`);

    const existingPR = await github.checkExistingPR(currentBranch);

    if (!existingPR || existingPR.state !== 'OPEN') {
      showErrorAndExit(
        `No open PR found for branch "${currentBranch}". Create a PR first with \`ai-cmds create-pr\`.`,
      );
    }

    console.log(`✅ Found PR #${existingPR.number}: ${existingPR.title}`);

    const isPushed = await github.checkBranchPushed(currentBranch);
    if (!isPushed) {
      console.log(`\n📤 Branch not pushed. Pushing to origin...`);
      await github.pushBranch(currentBranch);
      console.log(`✅ Branch pushed successfully.`);
    }

    const baseBranch =
      base ??
      resolveBaseBranch(config.baseBranch, currentBranch) ??
      existingPR.baseRefName;

    console.log(`\n📊 Gathering changes: ${currentBranch} → ${baseBranch}`);

    await git.fetchBranch(baseBranch).catch(() => {
      // Ignore if already fetched or doesn't exist
    });

    const changedFiles = await git.getChangedFiles(baseBranch);
    const excludePatterns = config.diffExcludePatterns;
    const filteredFiles = applyExcludePatterns(changedFiles, excludePatterns);

    if (filteredFiles.length === 0) {
      showErrorAndExit(
        `No changes found between ${currentBranch} and ${baseBranch}`,
      );
    }

    console.log(`   ${filteredFiles.length} files changed`);

    const provider = detectAvailableProvider();
    if (!provider) {
      showErrorAndExit(
        'No AI provider available. Set OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.',
      );
    }

    const templatePath = config.templatePath ?? DEFAULT_TEMPLATE_PATH;
    const templateContent = await loadTemplate(templatePath);
    const template = parseTemplate(templateContent);

    const diff = await git.getDiffToBranch(baseBranch, {
      includeFiles: filteredFiles,
      ignoreFiles: excludePatterns,
      silent: true,
    });

    console.log(`\n🤖 Generating PR description...`);

    let generatedContent: GeneratedPRContent = await generatePRContent({
      branchName: currentBranch,
      changedFiles: filteredFiles,
      diff,
      config,
      currentTitle: existingPR.title,
    });

    let prTitle = generatedContent.title;
    let prBody = buildPRBody(template, generatedContent);

    if (dryRun) {
      const separator = '='.repeat(60);
      console.log(`\n${separator}`);
      console.log('DRY RUN - Updated PR Preview');
      console.log(separator);
      console.log(`\nCurrent title: ${existingPR.title}`);
      console.log(`Suggested title: ${prTitle}`);
      console.log(`Base: ${baseBranch}`);
      console.log(`Head: ${currentBranch}`);
      console.log('\nBody:\n');
      console.log(prBody);
      console.log(`\n${separator}`);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const separator = '─'.repeat(60);
      console.log(`\n${separator}`);
      console.log(`Current title:   ${existingPR.title}`);
      console.log(`Suggested title: ${prTitle}`);
      console.log(`Summary: ${generatedContent.summary}`);
      console.log(separator);

      const action = await cliInput.select('What would you like to do?', {
        options: [
          {
            value: 'updateDescription' as const,
            label: 'Update description only',
          },
          {
            value: 'updateBoth' as const,
            label: 'Update description + title',
          },
          { value: 'editTitle' as const, label: 'Edit suggested title' },
          { value: 'regenerate' as const, label: 'Regenerate' },
          { value: 'cancel' as const, label: 'Cancel' },
        ],
      });

      if (action === 'cancel') {
        console.log('\n🚫 Cancelled.\n');
        return;
      }

      if (action === 'editTitle') {
        prTitle = await cliInput.text('PR title:', { initial: prTitle });
        continue;
      }

      if (action === 'regenerate') {
        const extraContext = await cliInput.text(
          'Additional context for regeneration (leave empty to just retry):',
        );

        console.log(`\n🤖 Regenerating PR description...`);

        const regenerateConfig = {
          ...config,
          ...(extraContext.trim() && {
            descriptionInstructions: [
              config.descriptionInstructions,
              extraContext.trim(),
            ]
              .filter(Boolean)
              .join('\n'),
          }),
        };

        try {
          generatedContent = await generatePRContent({
            branchName: currentBranch,
            changedFiles: filteredFiles,
            diff,
            config: regenerateConfig,
            currentTitle: existingPR.title,
          });

          prTitle = generatedContent.title;
          prBody = buildPRBody(template, generatedContent);
          console.log(`✅ Description regenerated successfully.`);
        } catch (error) {
          console.error('\n❌ Failed to regenerate PR description:', error);
        }
        continue;
      }

      if (action === 'updateDescription') {
        console.log(`\n📤 Updating PR #${existingPR.number} description...`);

        try {
          await github.updatePR({
            prNumber: existingPR.number,
            body: prBody,
          });
          console.log(
            `\n✅ PR #${existingPR.number} description updated: ${existingPR.url}`,
          );
        } catch (error) {
          console.error('\n❌ Failed to update PR description:', error);
        }
        return;
      }

      // action === 'updateBoth'
      console.log(
        `\n📤 Updating PR #${existingPR.number} title and description...`,
      );

      try {
        await github.updatePR({
          prNumber: existingPR.number,
          body: prBody,
          title: prTitle,
        });
        console.log(`\n✅ PR #${existingPR.number} updated: ${existingPR.url}`);
      } catch (error) {
        console.error('\n❌ Failed to update PR:', error);
      }
      return;
    }
  },
});
