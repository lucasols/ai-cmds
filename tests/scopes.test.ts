import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCOPES,
  scopeConfigsToOptions,
} from '../src/commands/shared/scopes.ts';

describe('scopes metadata', () => {
  it('sets explicit diffSource for built-in scopes', () => {
    expect(DEFAULT_SCOPES.all.diffSource).toBe('branch');
    expect(DEFAULT_SCOPES.staged.diffSource).toBe('staged');
    expect(DEFAULT_SCOPES.globs.diffSource).toBe('branch');
    expect(DEFAULT_SCOPES.unViewed.diffSource).toBe('branch');
  });

  it('builds options without context for lazy scope selection', () => {
    const options = scopeConfigsToOptions([
      DEFAULT_SCOPES.all,
      DEFAULT_SCOPES.staged,
    ]);

    expect(options).toEqual([
      { value: 'all', label: 'All changes' },
      { value: 'staged', label: 'Staged changes' },
    ]);
  });

  it('includes file counts when context is available', () => {
    const options = scopeConfigsToOptions(
      [DEFAULT_SCOPES.all, DEFAULT_SCOPES.staged],
      {
        allFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        stagedFiles: ['src/a.ts'],
      },
    );

    expect(options).toEqual([
      { value: 'all', label: 'All changes (3 files)' },
      { value: 'staged', label: 'Staged changes (1 files)' },
    ]);
  });
});
