import { it, expect } from 'vitest';
it('does AbortSignal.timeout pass (forks)', async () => {
  try {
    await fetch('http://localhost:9/x', { signal: AbortSignal.timeout(50) });
  } catch (e) {
    console.log('timeout-signal ERR:', String((e as Error).message).slice(0, 80));
  }
  expect(true).toBe(true);
});
