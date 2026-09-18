// Bound work across independent devices while keeping each item's work ordered.
export async function forEachConcurrent<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const results = await Promise.allSettled(Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  }));
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
