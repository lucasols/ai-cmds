import { runCmd } from '@ls-stack/node-utils/runShellCmd';
import { tool } from 'ai';
import { readFileSync } from 'fs';
import { z } from 'zod';

const readFileInputSchema = z.object({
  filename: z.string().describe('Path to the file to read'),
  readFromLine: z
    .number()
    .or(z.literal('startOfFile'))
    .describe('Line to start reading from (default: startOfFile)'),
  lines: z.number().or(z.literal('all')).describe('Number of lines to read'),
});

type ReadFileInput = z.infer<typeof readFileInputSchema>;

export function createReadFileTool(reviewerId?: number | string) {
  return tool({
    description: 'Read content of a specific file for additional context',
    inputSchema: readFileInputSchema,
    execute: ({
      filename,
      readFromLine: readFromLineOrStartOfFile,
      lines,
    }: ReadFileInput) => {
      const logPrefix = reviewerId ? `#${reviewerId}` : 'Review checker';
      try {
        const fileContent = readFileSync(filename, 'utf-8');

        const readFromLine =
          readFromLineOrStartOfFile === 'startOfFile' ? 1 : (
            readFromLineOrStartOfFile
          );

        const allLines = fileContent.split('\n');
        const startIndex = Math.max(0, readFromLine - 1);
        const selectedLines =
          lines === 'all' ?
            allLines.slice(startIndex)
          : allLines.slice(startIndex, startIndex + lines);
        const output = selectedLines.join('\n');

        console.log(
          `🛠️ ${logPrefix} read ${filename} (${lines === 'all' ? 'all lines' : `from line ${readFromLine} to ${startIndex + lines}`})`,
        );
        return output;
      } catch (error) {
        console.log(`🛠️ ${logPrefix} failed ❌ ${String(error)}`);
        return `Error reading ${filename}: ${String(error)}`;
      }
    },
  });
}

const listDirectoryInputSchema = z.object({
  directory: z.string().describe('Path to the directory to list'),
  recursive: z
    .boolean()
    .optional()
    .describe('Whether to list files recursively (default: false)'),
});

type ListDirectoryInput = z.infer<typeof listDirectoryInputSchema>;

export function createListDirectoryTool(reviewerId?: number | string) {
  return tool({
    description: 'List contents of a directory to understand project structure',
    inputSchema: listDirectoryInputSchema,
    execute: async ({ directory, recursive = false }: ListDirectoryInput) => {
      const logPrefix = reviewerId ? `#${reviewerId}` : 'Review checker';

      const args =
        recursive ? ['ls', '-la', '-R', directory] : ['ls', '-la', directory];
      const result = await runCmd(null, args, { silent: true });

      if (result.error) {
        console.log(`🛠️ ${logPrefix} failed ❌ ${result.stderr}`);
        return `Error listing directory ${directory}: ${result.stderr}`;
      }

      console.log(
        `🛠️ ${logPrefix} listed ${directory}${recursive ? ' (recursive)' : ''}`,
      );
      return result.stdout;
    },
  });
}

const ripgrepInputSchema = z.object({
  pattern: z
    .string()
    .describe(
      'The Perl regex pattern to search for, use properly escaped parentheses and braces',
    ),
  filePattern: z
    .string()
    .optional()
    .describe('Optional file pattern to limit search (e.g., "*.ts", "src/*")'),
  ignoreCase: z
    .boolean()
    .optional()
    .describe('Whether to ignore case in search (default: false)'),
  maxResults: z
    .number()
    .max(500)
    .optional()
    .describe('Maximum number of results to return (default: 50, max: 500)'),
});

type RipgrepInput = z.infer<typeof ripgrepInputSchema>;

export function createRipgrepTool(reviewerId?: number | string) {
  return tool({
    description:
      'Search for patterns in files using git grep (respects .gitignore)',
    inputSchema: ripgrepInputSchema,
    execute: async ({
      pattern,
      filePattern,
      ignoreCase = false,
      maxResults = 50,
    }: RipgrepInput) => {
      const logPrefix = reviewerId ? `#${reviewerId}` : 'Review checker';

      try {
        const args = ['git', 'grep', '-P'];

        if (ignoreCase) {
          args.push('-i');
        }

        args.push('-n');
        args.push(pattern);

        if (filePattern) {
          args.push('--', filePattern);
        }

        const result = await runCmd(null, args, { silent: true });

        if (result.error && result.stderr.includes('no matches found')) {
          console.log(
            `🛠️ ${logPrefix} searched for "${pattern}" - no matches found`,
          );
          return 'No matches found';
        }

        if (result.error) {
          console.log(`🛠️ ${logPrefix} ❌ failed to search for "${pattern}"`);
          return `Error searching for pattern "${pattern}": ${result.stderr}`;
        }

        if (!result.stdout.trim()) {
          console.log(
            `🛠️ ${logPrefix} searched for "${pattern}" - no matches found`,
          );
          return 'No matches found';
        }

        const lines = result.stdout
          .split('\n')
          .filter((line: string) => line.trim());
        const limitedLines = lines.slice(0, maxResults);
        const output = limitedLines.join('\n');

        const truncatedMessage =
          maxResults && lines.length > maxResults ?
            `\n... (showing first ${maxResults} of ${lines.length} matches)`
          : '';

        console.log(
          `🛠️ ${logPrefix} searched for "${pattern}"${filePattern ? ` in ${filePattern}` : ''} - found ${lines.length} matches`,
        );

        return output + truncatedMessage;
      } catch (error) {
        console.log(`🛠️ ${logPrefix} failed ❌ ${String(error)}`);
        return `Error searching for pattern "${pattern}": ${String(error)}`;
      }
    },
  });
}
