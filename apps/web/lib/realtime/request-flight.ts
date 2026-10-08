/** One catch-up at a time in a mounted scope. Invalidation prevents late
 * responses from updating a different conversation or an unmounted view. */
export function createRequestFlight() {
  let epoch = 0;
  let flight: symbol | null = null;
  return {
    invalidate() {
      epoch += 1;
      flight = null;
    },
    async run(work: (isCurrent: () => boolean) => Promise<void>) {
      if (flight !== null) return;
      const token = Symbol();
      const started = epoch;
      flight = token;
      try {
        await work(() => started === epoch);
      } finally {
        if (flight === token) flight = null;
      }
    },
  };
}
