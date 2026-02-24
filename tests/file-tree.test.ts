import { describe, expect, it } from 'vitest';
import { formatFileTree } from '../src/lib/file-tree.ts';

describe('formatFileTree', () => {
  it('returns empty array for empty input', () => {
    expect(formatFileTree([], 100)).toEqual([]);
  });

  it('renders a single file', () => {
    const lines = formatFileTree(['README.md'], 100);
    expect(lines).toEqual(['└── README.md']);
  });

  it('renders files in a flat directory', () => {
    const lines = formatFileTree(['a.ts', 'b.ts', 'c.ts'], 100);
    expect(lines).toEqual(['├── a.ts', '├── b.ts', '└── c.ts']);
  });

  it('renders nested directory structure', () => {
    const lines = formatFileTree(
      ['src/lib/config.ts', 'src/lib/git.ts', 'README.md'],
      100,
    );

    expect(lines).toEqual([
      '├── src/lib/',
      '│   ├── config.ts',
      '│   └── git.ts',
      '└── README.md',
    ]);
  });

  it('collapses single-child directories', () => {
    const lines = formatFileTree(
      ['src/commands/review/index.ts', 'src/lib/config.ts'],
      100,
    );

    expect(lines).toEqual([
      '└── src/',
      '    ├── commands/review/',
      '    │   └── index.ts',
      '    └── lib/',
      '        └── config.ts',
    ]);
  });

  it('renders the example from the plan', () => {
    const lines = formatFileTree(
      [
        'src/lib/config.ts',
        'src/lib/git.ts',
        'src/commands/review/index.ts',
        'README.md',
      ],
      100,
    );

    expect(lines).toEqual([
      '├── src/',
      '│   ├── lib/',
      '│   │   ├── config.ts',
      '│   │   └── git.ts',
      '│   └── commands/review/',
      '│       └── index.ts',
      '└── README.md',
    ]);
  });

  it('truncates when exceeding maxLines', () => {
    const files: string[] = [];
    for (let i = 0; i < 50; i++) {
      files.push(`src/deep/level1/level2/level3/file${i}.ts`);
    }
    for (let i = 0; i < 10; i++) {
      files.push(`src/other/file${i}.ts`);
    }

    const lines = formatFileTree(files, 10);
    expect(lines.length).toBeLessThanOrEqual(11); // 10 + possible truncation message
  });

  it('handles deeply nested single files', () => {
    const lines = formatFileTree(['a/b/c/d/e.ts'], 100);
    expect(lines).toEqual(['└── a/b/c/d/', '    └── e.ts']);
  });

  it('handles multiple top-level directories', () => {
    const lines = formatFileTree(
      ['src/index.ts', 'tests/index.test.ts', 'docs/readme.md'],
      100,
    );

    expect(lines).toEqual([
      '├── src/',
      '│   └── index.ts',
      '├── tests/',
      '│   └── index.test.ts',
      '└── docs/',
      '    └── readme.md',
    ]);
  });

  it('collapses deep levels when maxLines is small', () => {
    const files = [
      'src/a/b/c/file1.ts',
      'src/a/b/c/file2.ts',
      'src/a/b/c/file3.ts',
      'src/x/y/z/file4.ts',
      'src/x/y/z/file5.ts',
    ];

    const lines = formatFileTree(files, 5);
    expect(lines.length).toBeLessThanOrEqual(5);
    // Should contain collapsed summaries
    const joined = lines.join('\n');
    expect(joined).toContain('files)');
  });
});
