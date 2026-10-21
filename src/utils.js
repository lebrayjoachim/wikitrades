export async function withConcurrency(items, limit, fn) {
  if (items.length === 0) return;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}
