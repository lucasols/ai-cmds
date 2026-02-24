import { cliInput, createCmd } from '@ls-stack/cli';
import open from 'open';
import { loadConfig, resolveBaseBranch } from '../../lib/config.ts';
import { git } from '../../lib/git.ts';
import { github } from '../../lib/github.ts';
import { showErrorAndExit } from '../../lib/shell.ts';
import { applyExcludePatterns } from '../shared/diff-utils.ts';
import { detectAvailableProvider, generatePRContent } from './pr-generator.ts';
import { buildPRBody, loadTemplate, parseTemplate } from './template-parser.ts';

const DEFAULT_TEMPLATE_PATH = '.github/pull_request_template.md';

export const createPRCommand = createCmd({
  description: 'Create a GitHub PR with AI-generated description',
  short: 'cp',
  args: {
    base: {
      type: 'value-string-flag',
      name: 'base',
      description: 'Base branch for the PR',
    },
    noAi: {
      type: 'flag',
      name: 'no-ai',
      description: 'Skip AI generation, use template only',
    },
    dryRun: {
      type: 'flag',
      name: 'dry-run',
      description: 'Preview without opening browser',
    },
    title: {
      type: 'value-string-flag',
      name: 'title',
      description: 'Override PR title',
    },
  },
  examples: [
    { args: [], description: 'Create PR with AI-generated description' },
    { args: ['--base', 'develop'], description: 'Create PR against develop' },
    { args: ['--no-ai'], description: 'Create PR using template only' },
    { args: ['--dry-run'], description: 'Preview PR without opening browser' },
  ],
  run: async ({ base, noAi, dryRun, title: titleOverride }) => {
    const rootConfig = await loadConfig();
    const config = rootConfig.createPR ?? {};

    const currentBranch = git.getCurrentBranch();

    if (currentBranch === 'main' || currentBranch === 'master') {
      showErrorAndExit(
        `Cannot create PR from ${currentBranch} branch. Please checkout a feature branch.`,
      );
    }

    console.log(`\n🔍 Checking PR status for branch: ${currentBranch}`);

    const existingPR = await github.checkExistingPR(currentBranch);
    if (existingPR) {
      if (existingPR.state === 'OPEN') {
        console.log(`\n✅ PR already exists: ${existingPR.url}`);
        console.log(`   PR #${existingPR.number} is currently open.`);
        return;
      }

      if (existingPR.state === 'MERGED') {
        console.log(
          `\n⚠️  A PR from this branch was already merged: ${existingPR.url}`,
        );
        const shouldContinue = await cliInput.confirm(
          'Create a new PR from this branch anyway?',
        );
        if (!shouldContinue) {
          console.log('\n🚫 Cancelled.\n');
          return;
        }
      }
    }

    const isPushed = await github.checkBranchPushed(currentBranch);
    if (!isPushed) {
      console.log(`\n📤 Branch not pushed. Pushing to origin...`);
      await github.pushBranch(currentBranch);
      console.log(`✅ Branch pushed successfully.`);
    }

    const baseBranch = await resolveBaseBranchWithPrompt(
      base,
      config.baseBranch,
      currentBranch,
    );

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

    const templatePath = config.templatePath ?? DEFAULT_TEMPLATE_PATH;
    const templateContent = await loadTemplate(templatePath);
    const template = parseTemplate(templateContent);

    const diff = await git.getDiffToBranch(baseBranch, {
      includeFiles: filteredFiles,
      ignoreFiles: excludePatterns,
      silent: true,
    });

    let generatedContent: Awaited<ReturnType<typeof generatePRContent>> | null =
      null;
    let prTitle = titleOverride ?? currentBranch;
    let aiAvailable = false;

    if (!noAi) {
      const provider = detectAvailableProvider();
      if (!provider) {
        console.log(
          '\n⚠️  No AI provider configured. Set OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.',
        );
        console.log('   Falling back to template-only mode.\n');
      } else {
        aiAvailable = true;
        console.log(`\n🤖 Generating PR description...`);

        try {
          generatedContent = await generatePRContent({
            branchName: currentBranch,
            changedFiles: filteredFiles,
            diff,
            config,
          });

          if (!titleOverride) {
            prTitle = generatedContent.title;
          }

          console.log(`✅ Description generated successfully.`);
        } catch (error) {
          console.error('\n❌ Failed to generate PR description:', error);
          console.log('   Falling back to template-only mode.\n');
        }
      }
    }

    let prBody = buildPRBody(template, generatedContent);

    if (dryRun) {
      const separator = '='.repeat(60);
      console.log(`\n${separator}`);
      console.log('DRY RUN - PR Preview');
      console.log(separator);
      console.log(`\nTitle: ${prTitle}`);
      console.log(`Base: ${baseBranch}`);
      console.log(`Head: ${currentBranch}`);
      console.log('\nBody:\n');
      console.log(prBody);
      console.log(`\n${separator}`);
      return;
    }

    if (!generatedContent) {
      await openCompareUrl({
        baseBranch,
        currentBranch,
        prTitle,
        prBody,
      });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const separator = '─'.repeat(60);
      console.log(`\n${separator}`);
      console.log(`Title: ${prTitle}`);
      console.log(`Summary: ${generatedContent.summary}`);
      console.log(separator);

      const options = [
        { value: 'open' as const, label: 'Open in browser' },
        { value: 'publish' as const, label: 'Publish PR' },
        { value: 'editTitle' as const, label: 'Edit title' },
        ...(aiAvailable ?
          [{ value: 'regenerate' as const, label: 'Regenerate' }]
        : []),
        { value: 'cancel' as const, label: 'Cancel' },
      ];

      const action = await cliInput.select('What would you like to do?', {
        options,
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
          });

          if (!titleOverride) {
            prTitle = generatedContent.title;
          }

          prBody = buildPRBody(template, generatedContent);
          console.log(`✅ Description regenerated successfully.`);
        } catch (error) {
          console.error('\n❌ Failed to regenerate PR description:', error);
        }
        continue;
      }

      if (action === 'publish') {
        console.log(`\n📤 Creating PR...`);

        try {
          const pr = await github.createPR({
            baseBranch,
            title: prTitle,
            body: prBody,
          });

          console.log(`\n✅ PR #${pr.number} created: ${pr.url}`);

          try {
            await open(pr.url);
          } catch {
            // Browser open is best-effort
          }
        } catch (error) {
          console.error('\n❌ Failed to create PR:', error);
        }
        return;
      }

      // action === 'open'
      await openCompareUrl({
        baseBranch,
        currentBranch,
        prTitle,
        prBody,
      });
      return;
    }
  },
});

async function openCompareUrl(params: {
  baseBranch: string;
  currentBranch: string;
  prTitle: string;
  prBody: string;
}): Promise<void> {
  const { baseBranch, currentBranch, prTitle, prBody } = params;
  const { owner, repo } = await git.getRepoInfo();
  const compareUrl = github.buildCompareUrl({
    owner,
    repo,
    baseBranch,
    headBranch: currentBranch,
    title: prTitle,
    body: prBody,
  });

  console.log(`\n🌐 Opening GitHub to create PR...`);

  try {
    await open(compareUrl);
  } catch {
    console.log(`\n📋 Could not open browser. Use this URL:`);
    console.log(compareUrl);
  }

  console.log(`\n✅ Done! Complete the PR creation in your browser.`);
}

async function resolveBaseBranchWithPrompt(
  argBaseBranch: string | undefined,
  configBaseBranch: string | ((currentBranch: string) => string) | undefined,
  currentBranch: string,
): Promise<string> {
  const fromArgs =
    argBaseBranch ?? resolveBaseBranch(configBaseBranch, currentBranch);

  if (fromArgs) return fromArgs;

  const branches = await git.getLocalBranches();
  const otherBranches = branches.filter((b) => b !== currentBranch);

  if (otherBranches.length === 0) {
    showErrorAndExit('No other branches found to compare against');
  }

  const mainBranch = otherBranches.find(
    (b) => b === 'main' || b === 'master' || b === 'develop',
  );

  if (mainBranch && otherBranches.length <= 3) {
    return mainBranch;
  }

  return cliInput.select('Select the base branch', {
    options: otherBranches.map((branch) => ({
      value: branch,
      label: branch,
    })),
  });
}
