import { createCmd } from '@ls-stack/cli';
import { createGlobalEnvFile } from '../../lib/global-env.ts';

export const setGlobalEnvsCommand = createCmd({
  description:
    'Create a global .env file at ~/.config/ai-cmds/.env for shared API keys',
  run: () => {
    const { created, path } = createGlobalEnvFile();

    if (created) {
      console.log(`✅ Global env file created at: ${path}`);
      console.log('   Edit this file to add your API keys.');
    } else {
      console.log(`ℹ️  Global env file already exists at: ${path}`);
    }
  },
});
