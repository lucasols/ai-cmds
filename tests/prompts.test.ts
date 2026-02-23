import { describe, expect, it, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import {
  createReviewPrompt,
  createValidationPrompt,
  stripYamlFrontmatter,
} from '../src/commands/shared/prompts.ts';
import { createZeroTokenUsage } from '../src/commands/shared/output.ts';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
  };
});

vi.mock('../src/lib/git.ts', () => ({
  git: {
    getGitRoot: vi.fn(() => '/mock/git/root'),
    getCurrentBranch: vi.fn(() => 'test-branch'),
  },
}));

const context = { type: 'local' as const };
const changedFiles = ['src/example.ts'];
const prDiff = 'diff --git a/src/example.ts b/src/example.ts';

describe('review prompt instruction options', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it('appends custom instruction while keeping default instructions', () => {
    const prompt = createReviewPrompt(context, null, changedFiles, prDiff, {
      includeAgentsFileInReviewPrompt: false,
      customReviewInstruction: 'Focus on authorization and access checks.',
    });

    expect(prompt.system).toContain('# Code Review Instructions');
    expect(prompt.system).toContain('Trust the tooling');
    expect(prompt.system).toContain('## Additional Focus');
    expect(prompt.system).toContain('Focus on authorization and access checks.');
  });

  it('can skip default instructions', () => {
    const prompt = createReviewPrompt(context, null, changedFiles, prDiff, {
      includeAgentsFileInReviewPrompt: false,
      includeDefaultReviewInstructions: false,
      customReviewInstruction: 'Prioritize data integrity issues.',
    });

    expect(prompt.system).not.toContain('Trust the tooling');
    expect(prompt.system).toContain('Prioritize data integrity issues.');
  });

  it('uses fallback instructions when defaults are disabled and no custom instruction is provided', () => {
    const prompt = createReviewPrompt(context, null, changedFiles, prDiff, {
      includeAgentsFileInReviewPrompt: false,
      includeDefaultReviewInstructions: false,
    });

    expect(prompt.system).toContain('Focus on concrete, actionable issues');
  });

  it('applies instruction options to validation prompts', () => {
    const prompt = createValidationPrompt(
      context,
      [
        {
          reviewerId: 1,
          content: 'No issues identified in this review.',
          usage: createZeroTokenUsage('gpt-5.2'),
        },
      ],
      null,
      changedFiles,
      prDiff,
      undefined,
      {
        includeDefaultReviewInstructions: false,
        customReviewInstruction: 'Focus only on concurrency and race conditions.',
      },
    );

    expect(prompt.system).not.toContain('Trust the tooling');
    expect(prompt.system).toContain(
      'Focus only on concurrency and race conditions.',
    );
  });
});

describe('stripYamlFrontmatter', () => {
  it('strips valid YAML frontmatter', () => {
    const input = '---\ntitle: Test\ntags: [review]\n---\n# Content here';
    expect(stripYamlFrontmatter(input)).toBe('# Content here');
  });

  it('returns content as-is when no frontmatter', () => {
    const input = '# Content\nSome text';
    expect(stripYamlFrontmatter(input)).toBe('# Content\nSome text');
  });

  it('returns content as-is when frontmatter is unclosed', () => {
    const input = '---\ntitle: Test\n# Content without closing';
    expect(stripYamlFrontmatter(input)).toBe(
      '---\ntitle: Test\n# Content without closing',
    );
  });

  it('trims leading whitespace after stripping frontmatter', () => {
    const input = '---\ntitle: Test\n---\n\n\n# Content';
    expect(stripYamlFrontmatter(input)).toBe('# Content');
  });
});

describe('review instructions fallback paths', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReset();
  });

  it('uses first fallback path when it exists', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(existsSync).mockImplementation(
      (p) => String(p) === '/mock/git/root/.agents/CODE_REVIEW.md',
    );
    vi.mocked(readFileSync).mockReturnValue('# Custom from fallback');

    const prompt = createReviewPrompt(context, null, changedFiles, prDiff, {
      includeAgentsFileInReviewPrompt: false,
    });

    expect(prompt.system).toContain('# Custom from fallback');
    expect(prompt.system).not.toContain('Trust the tooling');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Using review instructions from .agents/CODE_REVIEW.md',
      ),
    );
    logSpy.mockRestore();
  });

  it('uses second fallback path when first is missing', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(existsSync).mockImplementation(
      (p) =>
        String(p) ===
        '/mock/git/root/.agents/skills/code-review/SKILL.md',
    );
    vi.mocked(readFileSync).mockReturnValue('# Skill instructions');

    const prompt = createReviewPrompt(context, null, changedFiles, prDiff, {
      includeAgentsFileInReviewPrompt: false,
    });

    expect(prompt.system).toContain('# Skill instructions');
    expect(prompt.system).not.toContain('Trust the tooling');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Using review instructions from .agents/skills/code-review/SKILL.md',
      ),
    );
    logSpy.mockRestore();
  });

  it('falls back to defaults when no fallback paths exist', () => {
    const prompt = createReviewPrompt(context, null, changedFiles, prDiff, {
      includeAgentsFileInReviewPrompt: false,
    });

    expect(prompt.system).toContain('# Code Review Instructions');
    expect(prompt.system).toContain('Trust the tooling');
  });

  it('returns defaults when reviewInstructionsPath is false', () => {
    const prompt = createReviewPrompt(context, null, changedFiles, prDiff, {
      includeAgentsFileInReviewPrompt: false,
      reviewInstructionsPath: false,
    });

    expect(prompt.system).toContain('# Code Review Instructions');
    expect(prompt.system).toContain('Trust the tooling');
  });

  it('strips frontmatter from explicit path file', () => {
    vi.mocked(existsSync).mockImplementation(
      (p) => String(p) === '/custom/instructions.md',
    );
    vi.mocked(readFileSync).mockReturnValue(
      '---\ntitle: Review\n---\n# Custom instructions from file',
    );

    const prompt = createReviewPrompt(context, null, changedFiles, prDiff, {
      includeAgentsFileInReviewPrompt: false,
      reviewInstructionsPath: '/custom/instructions.md',
    });

    expect(prompt.system).toContain('# Custom instructions from file');
    expect(prompt.system).not.toContain('title: Review');
    expect(prompt.system).not.toContain('Trust the tooling');
  });

  it('strips frontmatter from fallback path file', () => {
    vi.mocked(existsSync).mockImplementation(
      (p) => String(p) === '/mock/git/root/.agents/CODE_REVIEW.md',
    );
    vi.mocked(readFileSync).mockReturnValue(
      '---\nname: code-review\n---\n# Auto-detected instructions',
    );

    const prompt = createReviewPrompt(context, null, changedFiles, prDiff, {
      includeAgentsFileInReviewPrompt: false,
    });

    expect(prompt.system).toContain('# Auto-detected instructions');
    expect(prompt.system).not.toContain('name: code-review');
  });
});
