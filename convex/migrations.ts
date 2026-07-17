import { internalMutation } from "./_generated/server";

// One-off: drop the pre-launch prototype rows (anonName-era test runs). Their
// scores are on the old distance+bonus scale and would sit above every real
// points-based run forever.
export const clearPrototypeScores = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("scores").collect();
    const stale = rows.filter((row) => row.anonName !== undefined || row.userId === undefined);
    await Promise.all(stale.map((row) => ctx.db.delete(row._id)));
    return stale.length;
  },
});

// One-off, idempotent: stamp category on pre-category score rows (gpu:/mem:/tok: prefix).
export const backfillScoreCategories = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("scores").collect();
    const patches: Promise<void>[] = [];
    for (const row of rows) {
      if (row.category) continue;
      const prefix = row.trackId.split(":")[0];
      const category =
        prefix === "gpu" ? "compute" : prefix === "mem" ? "memory" : prefix === "tok" ? "tokens" : null;
      if (!category) continue;
      patches.push(ctx.db.patch(row._id, { category }));
    }
    await Promise.all(patches);
    return patches.length;
  },
});

// One-off, idempotent: collapse duplicate rows to each rider's best per track
// (submitRun used to insert a row per crash).
export const dedupeScores = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("scores").collect();
    const best = new Map<string, (typeof rows)[number]>();
    let deleted = 0;
    for (const row of rows) {
      const key = `${row.userId ?? "anon"}:${row.trackId}`;
      const prev = best.get(key);
      if (!prev) {
        best.set(key, row);
      } else if (row.score > prev.score) {
        await ctx.db.delete(prev._id);
        best.set(key, row);
        deleted += 1;
      } else {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return deleted;
  },
});
