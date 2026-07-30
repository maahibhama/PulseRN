function calculateLineTotal(values: number[], multiplier: number): number {
  let total = 0;
  for (const value of values) {
    const weighted = value * multiplier;
    total += weighted;
  }
  return total;
}

async function loadDebuggerLabel(total: number): Promise<string> {
  await Promise.resolve();
  return total >= 20 ? 'large result' : 'small result';
}

export async function runLineDebuggerDemo(seed: number): Promise<string> {
  const values = [seed, seed + 1, seed + 2];
  const multiplier = 2;
  const total = calculateLineTotal(values, multiplier);
  let caughtMessage = '';
  try {
    throw new Error('Caught debugger demonstration');
  } catch (error) {
    caughtMessage = error instanceof Error ? error.message : String(error);
  }
  const label = await loadDebuggerLabel(total);
  return `${label}: ${total} · ${caughtMessage}`;
}

export async function runUnhandledDebuggerDemo(): Promise<never> {
  await Promise.resolve();
  throw new Error('Uncaught PulseRN debugger demonstration');
}
