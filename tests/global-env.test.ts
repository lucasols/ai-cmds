import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => testHomeDir };
});

let testHomeDir: string;

const {
  getGlobalEnvPath,
  globalEnvExists,
  createGlobalEnvFile,
} = await import('../src/lib/global-env.ts');

describe('global-env', () => {
  beforeEach(() => {
    testHomeDir = join(process.cwd(), 'temp-test-global-env');
    rmSync(testHomeDir, { recursive: true, force: true });
    mkdirSync(testHomeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testHomeDir, { recursive: true, force: true });
  });

  describe('getGlobalEnvPath', () => {
    it('returns path under ~/.config/ai-cmds/.env', () => {
      const envPath = getGlobalEnvPath();
      expect(envPath).toBe(join(testHomeDir, '.config', 'ai-cmds', '.env'));
    });
  });

  describe('globalEnvExists', () => {
    it('returns false when file does not exist', () => {
      expect(globalEnvExists()).toBe(false);
    });

    it('returns true when file exists', () => {
      const envPath = getGlobalEnvPath();
      mkdirSync(join(testHomeDir, '.config', 'ai-cmds'), { recursive: true });
      const { writeFileSync } = require('fs');
      writeFileSync(envPath, 'KEY=value\n');
      expect(globalEnvExists()).toBe(true);
    });
  });

  describe('createGlobalEnvFile', () => {
    it('creates the file with template when it does not exist', () => {
      const result = createGlobalEnvFile();
      expect(result.created).toBe(true);
      expect(result.path).toBe(getGlobalEnvPath());
      expect(existsSync(result.path)).toBe(true);

      const content = readFileSync(result.path, 'utf-8');
      expect(content).toContain('OPENAI_API_KEY');
      expect(content).toContain('GOOGLE_GENERATIVE_AI_API_KEY');
      expect(content).toContain('AI_CLI_LOGS_DIR');
    });

    it('returns created: false when file already exists', () => {
      createGlobalEnvFile();
      const result = createGlobalEnvFile();
      expect(result.created).toBe(false);
      expect(result.path).toBe(getGlobalEnvPath());
    });
  });
});
