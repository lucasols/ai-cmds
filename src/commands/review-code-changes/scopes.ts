import type {
  ReviewCodeChangesConfig,
  ScopeConfig,
  ScopeContext,
} from '../../lib/config.ts';

export const DEFAULT_SCOPES = {
  all: {
    label: 'all',
    getFiles: (ctx: ScopeContext) => ctx.allFiles,
  },
  staged: {
    label: 'staged',
    getFiles: (ctx: ScopeContext) => ctx.stagedFiles,
  },
  pr: {
    label: 'pr',
    getFiles: (ctx: ScopeContext) => ctx.allFiles,
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
 *       { label: 'myCustomScope', getFiles: (ctx) => ctx.allFiles.filter(...) },
 *     ],
 *   },
 * });
 * ```
 */
export const BUILT_IN_SCOPE_OPTIONS: ScopeConfig[] =
  Object.values(DEFAULT_SCOPES);

/**
 * Resolves a scope by name. Checks custom scopes first, then built-in defaults.
 * Returns undefined if no scope is specified (to trigger interactive selection).
 */
export function resolveScope(
  config: ReviewCodeChangesConfig,
  scopeLabel?: string,
): ScopeConfig | undefined {
  if (!scopeLabel) {
    return undefined;
  }

  // First check custom scopes by label
  const customScope = config.scope?.find((s) => s.label === scopeLabel);
  if (customScope) {
    return customScope;
  }

  // Then check built-in defaults
  return DEFAULT_SCOPES[scopeLabel as keyof typeof DEFAULT_SCOPES];
}

/**
 * Get all available scope labels (built-in + custom).
 */
export function getAvailableScopes(config: ReviewCodeChangesConfig): string[] {
  // If custom scopes are configured, only show those
  if (config.scope && config.scope.length > 0) {
    return config.scope.map((s) => s.label);
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
  scope: ScopeConfig,
  ctx: ScopeContext,
): number | null {
  if (!scope.showFileCount) {
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
