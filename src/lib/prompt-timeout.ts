const DEFAULT_PROMPT_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Exits the process if the prompt is not answered within the timeout. Used on
 * final prompts so an abandoned terminal doesn't keep the CLI running forever.
 */
export async function withPromptTimeout<T>(
  prompt: Promise<T>,
  timeoutMs: number = DEFAULT_PROMPT_TIMEOUT_MS,
): Promise<T> {
  const timeout = setTimeout(() => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    const minutes = Math.round(timeoutMs / 60_000);
    console.log(`\n\n⏱️  No response in ${minutes} minutes, exiting.\n`);
    process.exit(0);
  }, timeoutMs);

  try {
    return await prompt;
  } finally {
    clearTimeout(timeout);
  }
}
