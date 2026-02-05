import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { describe, expect, it } from 'vitest';
import { persistReviewRunLogs } from '../src/commands/shared/review-logs.ts';
import { createZeroTokenUsage } from '../src/commands/shared/output.ts';

describe('persistReviewRunLogs', () => {
  it('writes review artifacts to the configured logs directory', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'ai-cli-review-logs-'));

    try {
      const runDir = await persistReviewRunLogs({
        logsDir: baseDir,
        command: 'review-code-changes',
        context: { type: 'local' },
        setupId: 'medium',
        scopeId: 'staged',
        branchName: 'feat/cool-branch',
        runStartedAt: new Date('2026-02-05T18:00:00.000Z'),
        runEndedAt: new Date('2026-02-05T18:00:05.000Z'),
        changedFiles: ['src/a.ts', 'src/b.ts'],
        prDiff: 'diff --git a/src/a.ts b/src/a.ts',
        reviews: [
          {
            reviewerId: 1,
            content: '## 📋 Review Summary\n\nReviewer content',
            usage: createZeroTokenUsage('gpt-5.2'),
          },
        ],
        validatedReview: {
          summary: 'Validated summary',
          issues: [
            {
              category: 'possible',
              files: [{ path: 'src/a.ts', line: 10 }],
              description: 'Potential issue',
              currentCode: null,
              suggestedFix: null,
            },
          ],
          usage: createZeroTokenUsage('gpt-5.2'),
        },
        finalReviewMarkdown: '# Final Review',
        outputFilePath: 'pr-review.md',
      });

      expect(basename(runDir)).toMatch(
        /^feat-cool-branch-2026-02-05_18-00-00-[a-z0-9]{6}$/,
      );
      expect(readFileSync(join(runDir, 'context.yaml'), 'utf-8')).toContain(
        'src/a.ts',
      );
      expect(readFileSync(join(runDir, 'changed-files.txt'), 'utf-8')).toContain(
        'src/b.ts',
      );
      expect(readFileSync(join(runDir, 'diff.diff'), 'utf-8')).toContain(
        'diff --git',
      );
      expect(readFileSync(join(runDir, 'final-review.md'), 'utf-8')).toContain(
        '# Final Review',
      );
      expect(
        readFileSync(join(runDir, 'reviewers', 'reviewer-1.md'), 'utf-8'),
      ).toContain('Review Summary');
      expect(
        readFileSync(join(runDir, 'reviewers', 'reviewer-1-debug.yaml'), 'utf-8'),
      ).toContain('reviewerId: 1');
      expect(readFileSync(join(runDir, 'summary.yaml'), 'utf-8')).toContain(
        'durationMs: 5000',
      );
      expect(readFileSync(join(runDir, 'context.yaml'), 'utf-8')).toContain(
        "setupId: 'medium'",
      );
      expect(readFileSync(join(runDir, 'context.yaml'), 'utf-8')).toContain(
        "scopeId: 'staged'",
      );
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
