import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearConfigCache,
  defineConfig,
  loadConfig,
} from '../src/lib/config.ts';
import * as globalEnv from '../src/lib/global-env.ts';

describe('config', () => {
  afterEach(() => {
    clearConfigCache();
  });

  it('defineConfig returns the config unchanged', () => {
    const config = defineConfig({
      codeReview: {
        baseBranch: 'main',
        codeReviewDiffExcludePatterns: ['*.md'],
      },
    });

    expect(config).toEqual({
      codeReview: {
        baseBranch: 'main',
        codeReviewDiffExcludePatterns: ['*.md'],
      },
    });
  });

  it('loadConfig returns empty config when no config file exists', async () => {
    const config = await loadConfig('/nonexistent/path');
    expect(config).toEqual({});
  });
});

describe('loadDotEnv', () => {
  it('loads env files from config', async () => {
    const testDir = join(process.cwd(), 'temp-test-dotenv');
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    writeFileSync(join(testDir, '.env'), 'TEST_DEFAULT_VAR=default_value\n');
    writeFileSync(
      join(testDir, '.env.local'),
      'TEST_LOCAL_VAR=local_value\nTEST_OVERRIDE_VAR=from_local\n',
    );
    writeFileSync(
      join(testDir, '.env.custom'),
      'TEST_CUSTOM_VAR=custom_value\nTEST_OVERRIDE_VAR=from_custom\n',
    );
    writeFileSync(
      join(testDir, 'ai-cmds.config.ts'),
      `export default { loadDotEnv: ['.env.local', '.env.custom'] };`,
    );

    clearConfigCache();
    await loadConfig(testDir);

    expect(process.env.TEST_DEFAULT_VAR).toBe('default_value');
    expect(process.env.TEST_LOCAL_VAR).toBe('local_value');
    expect(process.env.TEST_CUSTOM_VAR).toBe('custom_value');
    expect(process.env.TEST_OVERRIDE_VAR).toBe('from_custom');

    rmSync(testDir, { recursive: true, force: true });
    delete process.env.TEST_DEFAULT_VAR;
    delete process.env.TEST_CUSTOM_VAR;
    delete process.env.TEST_LOCAL_VAR;
    delete process.env.TEST_OVERRIDE_VAR;
  });
});

describe('global env fallback', () => {
  afterEach(() => {
    clearConfigCache();
    vi.restoreAllMocks();
  });

  it('loads global env when local .env is missing', async () => {
    const testDir = join(process.cwd(), 'temp-test-global-fallback');
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    const globalEnvDir = join(testDir, 'global-config');
    mkdirSync(globalEnvDir, { recursive: true });
    const globalEnvPath = join(globalEnvDir, '.env');
    writeFileSync(globalEnvPath, 'TEST_GLOBAL_FALLBACK_VAR=global_value\n');

    vi.spyOn(globalEnv, 'getGlobalEnvPath').mockReturnValue(globalEnvPath);

    clearConfigCache();
    await loadConfig(testDir);

    expect(process.env.TEST_GLOBAL_FALLBACK_VAR).toBe('global_value');

    rmSync(testDir, { recursive: true, force: true });
    delete process.env.TEST_GLOBAL_FALLBACK_VAR;
  });

  it('skips global env when local .env exists', async () => {
    const testDir = join(process.cwd(), 'temp-test-global-skip');
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    writeFileSync(
      join(testDir, '.env'),
      'TEST_LOCAL_ONLY_VAR=local_value\n',
    );

    const globalEnvDir = join(testDir, 'global-config');
    mkdirSync(globalEnvDir, { recursive: true });
    const globalEnvPath = join(globalEnvDir, '.env');
    writeFileSync(
      globalEnvPath,
      'TEST_GLOBAL_SHOULD_NOT_LOAD=should_not_load\n',
    );

    vi.spyOn(globalEnv, 'getGlobalEnvPath').mockReturnValue(globalEnvPath);

    clearConfigCache();
    await loadConfig(testDir);

    expect(process.env.TEST_LOCAL_ONLY_VAR).toBe('local_value');
    expect(process.env.TEST_GLOBAL_SHOULD_NOT_LOAD).toBeUndefined();

    rmSync(testDir, { recursive: true, force: true });
    delete process.env.TEST_LOCAL_ONLY_VAR;
  });
});
