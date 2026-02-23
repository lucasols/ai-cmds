const globalAbortController = new AbortController();

const handler = () => {
  console.log('\nAborting...');
  globalAbortController.abort();
  process.removeListener('SIGINT', handler);
};

process.on('SIGINT', handler);

export const globalAbortSignal: AbortSignal = globalAbortController.signal;
