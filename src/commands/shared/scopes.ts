import { cliInput } from '@ls-stack/cli';
import { matchesGlob } from 'node:path';
import type {
  ReviewCodeChangesConfig,
  ScopeConfig,
  ScopeContext,
} from '../../lib/config.ts';
import { getUnviewedPRFiles } from '../../lib/github.ts';
import { runCmd } from '@ls-stack/node-utils/runShellCmd';

async function findPRForCurrentBranch(): Promise<string | undefined> {
  const result = await runCmd(null, ['gh', 'pr', 'view', '--json', 'number'], {
    silent: true,
    noCiColorForce: true,
  });

  if (result.error) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(result.stdout) as { number: number };
    return String(parsed.number);
  } catch {
    return undefined;
  }
}

function filterFilesWithGlobPatterns(
  files: string[],
  patterns: string[],
): string[] {
  const includePatterns: string[] = [];
  const excludePatterns: string[] = [];

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      excludePatterns.push(normalizeGlobPattern(pattern.slice(1)));
    } else {
      includePatterns.push(normalizeGlobPattern(pattern));
    }
  }

  let matchedFiles = files;

  if (includePatterns.length > 0) {
    matchedFiles = files.filter((file) =>
      includePatterns.some((pattern) => matchesGlob(file, pattern)),
    );
  }

  if (excludePatterns.length > 0) {
    matchedFiles = matchedFiles.filter(
      (file) => !excludePatterns.some((pattern) => matchesGlob(file, pattern)),
    );
  }

  return matchedFiles;
}

function normalizeGlobPattern(pattern: string): string {
  if (
    !pattern.includes('*') &&
    !pattern.includes('?') &&
    !pattern.includes('[')
  ) {
    return `**/${pattern}/**`;
  }
  return pattern;
}

async function selectFilesWithGlobPatterns(
  allFiles: string[],
): Promise<string[]> {
  for (;;) {
    const input = await cliInput.text(
      'Enter glob patterns (space-separated, use !pattern to exclude)',
      {
        validate: (value) => {
          if (!value.trim()) {
            return 'Please enter at least one pattern';
          }
          return true;
        },
      },
    );

    const patterns = input.trim().split(/\s+/);
    const matchedFiles = filterFilesWithGlobPatterns(allFiles, patterns);

    if (matchedFiles.length === 0) {
      console.log('\n⚠️  No files matched the patterns. Please try again.\n');
      continue;
    }

    console.log(`\n📁 Matched ${matchedFiles.length} files:`);
    for (const file of matchedFiles.slice(0, 10)) {
      console.log(`   ${file}`);
    }
    if (matchedFiles.length > 10) {
      console.log(`   ... and ${matchedFiles.length - 10} more`);
    }
    console.log('');

    const confirmed = await cliInput.confirm('Use these files?', {
      initial: true,
    });

    if (confirmed) {
      return matchedFiles;
    }
  }
}

export const DEFAULT_SCOPES = {
  all: {
    id: 'all',
    label: 'All changes',
    diffSource: 'branch',
    showFileCount: true,
    getFiles: (ctx: ScopeContext) => ctx.allFiles,
  },
  staged: {
    id: 'staged',
    label: 'Staged changes',
    diffSource: 'staged',
    showFileCount: true,
    getFiles: (ctx: ScopeContext) => ctx.stagedFiles,
  },
  globs: {
    id: 'globs',
    label: 'Select files using glob patterns (use !pattern to exclude)',
    diffSource: 'branch',
    showFileCount: false,
    getFiles: (ctx: ScopeContext) => selectFilesWithGlobPatterns(ctx.allFiles),
  },
  unViewed: {
    id: 'unViewed',
    label: 'Unviewed files in PR',
    diffSource: 'branch',
    showFileCount: false,
    getFiles: async () => {
      const prNumber = await findPRForCurrentBranch();
      if (!prNumber) {
        throw new Error(
          'No open PR found for current branch. The unViewed scope requires an open PR.',
        );
      }
      console.log(`Getting unviewed files from PR #${prNumber}...`);
      return getUnviewedPRFiles(prNumber);
    },
  },
} as const satisfies Record<string, ScopeConfig>;

/**
 * Built-in scope options that users can include in their config.
 * When custom scopes are configured, they replace built-in options.
 * Use this export to include built-in options alongside custom ones:
 *
 * @example
 * ```typescript
 * import { defineConfig, BUILT_IN_SCOPE_OPTIONS } from 'ai-cmds';
 *
 * export default defineConfig({
 *   reviewCodeChanges: {
 *     scope: [
 *       ...BUILT_IN_SCOPE_OPTIONS,
 *       { id: 'custom', label: 'My Custom Scope', getFiles: (ctx) => ctx.allFiles.filter(...) },
 *     ],
 *   },
 * });
 * ```
 */
export const BUILT_IN_SCOPE_OPTIONS: ScopeConfig[] =
  Object.values(DEFAULT_SCOPES);

/**
 * Resolves a scope by id. Checks custom scopes first, then built-in defaults.
 * Returns undefined if no scope is specified (to trigger interactive selection).
 */
export function resolveScope(
  config: ReviewCodeChangesConfig,
  scopeId?: string,
): ScopeConfig | undefined {
  if (!scopeId) {
    return undefined;
  }

  // First check custom scopes by id
  const customScope = config.scope?.find((s) => s.id === scopeId);
  if (customScope) {
    return customScope;
  }

  // Then check built-in defaults
  return DEFAULT_SCOPES[scopeId as keyof typeof DEFAULT_SCOPES];
}

/**
 * Get all available scope ids (built-in + custom).
 */
export function getAvailableScopes(config: ReviewCodeChangesConfig): string[] {
  // If custom scopes are configured, only show those
  if (config.scope && config.scope.length > 0) {
    return config.scope.map((s) => s.id);
  }
  // Otherwise show built-in defaults
  return Object.keys(DEFAULT_SCOPES);
}

/**
 * Attempts to get file count synchronously from a scope.
 * Returns null if showFileCount is falsy or if getFiles returns a Promise.
 * When showFileCount is falsy, getFiles is not called (lazy evaluation).
 */
export function tryGetFileCountSync(
  scope: ScopeConfig & { showFileCount?: boolean },
  ctx?: ScopeContext,
): number | null {
  if (!scope.showFileCount || !ctx) {
    return null;
  }

  try {
    const result = scope.getFiles(ctx);
    if (Array.isArray(result)) {
      return result.length;
    }
    // Promise, can't get count synchronously
    return null;
  } catch {
    return null;
  }
}

/**
 * Converts scope configs to CLI select options with file counts.
 */
export function scopeConfigsToOptions(
  scopes: ScopeConfig[],
  ctx?: ScopeContext,
): Array<{ value: string; label: string }> {
  return scopes.map((s) => {
    const fileCount = tryGetFileCountSync(s, ctx);
    return {
      value: s.id,
      label: fileCount !== null ? `${s.label} (${fileCount} files)` : s.label,
    };
  });
}
