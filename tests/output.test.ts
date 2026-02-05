import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/git.ts', () => ({
  git: {
    getRepoInfo: vi.fn(async () => ({ owner: 'acme', repo: 'repo' })),
  },
}));

vi.mock('../src/lib/github.ts', () => ({
  github: {
    createPRComment: vi.fn(async () => {}),
  },
}));

vi.mock('../src/lib/shell.ts', () => ({
  runCmdSilentUnwrap: vi.fn(async () => 'abc123'),
}));

import {
  createZeroTokenUsage,
  formatValidatedReview,
} from '../src/commands/shared/output.ts';
import type {
  LocalReviewContext,
  PRReviewContext,
  ValidatedReview,
} from '../src/commands/shared/types.ts';
import { git } from '../src/lib/git.ts';

describe('formatValidatedReview', () => {
  beforeEach(() => {
    vi.mocked(git.getRepoInfo).mockClear();
  });

  it('preserves code indentation and renders issue IDs with snapshot', async () => {
    const context: PRReviewContext = {
      type: 'pr',
      prNumber: '123',
      mode: 'gh-actions',
    };

    const review: ValidatedReview = {
      summary: 'Validation summary',
      usage: createZeroTokenUsage('validator'),
      issues: [
        {
          category: 'critical',
          files: [{ path: 'src/example.ts', line: 12 }],
          description: 'Incorrect return shape causes runtime failures.',
          currentCode: `function getData() {\n  return {\n    ok: false,\n  };\n}`,
          suggestedFix: `\`\`\`diff\n function getData() {\n-  return {\n-    ok: false,\n-  };\n+  return {\n+    ok: true,\n+  };\n }\n\`\`\``,
        },
      ],
    };

    const markdown = await formatValidatedReview(
      review,
      'octocat',
      context,
      'feature/refactor',
      {
        reviews: [],
        validatorUsage: createZeroTokenUsage('validator'),
      },
    );

    expect(markdown).toContain('## 📊 Findings Snapshot');
    expect(markdown).toContain('#### C1');
    expect(markdown).toContain(
      `function getData() {\n  return {\n    ok: false,\n  };\n}`,
    );
    expect(markdown).toContain('### 🔴 Critical Problems (1)');
  });

  it('does not require GitHub repo info for local reviews', async () => {
    vi.mocked(git.getRepoInfo).mockRejectedValueOnce(
      new Error('repo info should not be required'),
    );

    const context: LocalReviewContext = {
      type: 'local',
    };

    const review: ValidatedReview = {
      summary: 'Validation summary',
      usage: createZeroTokenUsage('validator'),
      issues: [
        {
          category: 'possible',
          files: [{ path: 'src/local.ts', line: 5 }],
          description: 'Potential local issue.',
          currentCode: null,
          suggestedFix: null,
        },
      ],
    };

    const markdown = await formatValidatedReview(
      review,
      'octocat',
      context,
      'feature/local-branch',
      {
        reviews: [],
        validatorUsage: createZeroTokenUsage('validator'),
      },
    );

    expect(vi.mocked(git.getRepoInfo)).not.toHaveBeenCalled();
    expect(markdown).toContain('Review of branch feature/local-branch');
    expect(markdown).toContain('[src/local.ts:5](/src/local.ts#L5)');
  });
});
