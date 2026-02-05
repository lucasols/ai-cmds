import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  defineConfig,
  clearConfigCache,
  loadConfig,
} from '../src/lib/config.ts';

describe('config', () => {
  afterEach(() => {
    clearConfigCache();
  });

  it('defineConfig returns the config unchanged', () => {
    const config = defineConfig({
      reviewCodeChanges: {
        baseBranch: 'main',
        codeReviewDiffExcludePatterns: ['*.md'],
      },
    });

    expect(config).toEqual({
      reviewCodeChanges: {
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
      join(testDir, 'ai-cli.config.ts'),
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
