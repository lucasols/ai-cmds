import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

const GLOBAL_ENV_TEMPLATE = `# ai-cmds global environment variables
# These are used as fallback when no local .env file exists in a project.

# OPENAI_API_KEY=
# GOOGLE_GENERATIVE_AI_API_KEY=
# AI_CLI_LOGS_DIR=
`;

export function getGlobalEnvPath(): string {
  return join(homedir(), '.config', 'ai-cmds', '.env');
}

export function globalEnvExists(): boolean {
  return existsSync(getGlobalEnvPath());
}

export function createGlobalEnvFile(): { created: boolean; path: string } {
  const envPath = getGlobalEnvPath();

  if (existsSync(envPath)) {
    return { created: false, path: envPath };
  }

  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, GLOBAL_ENV_TEMPLATE, 'utf-8');

  return { created: true, path: envPath };
}
