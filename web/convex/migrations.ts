import { internalMutation } from "./_generated/server";

// One-off, idempotent: stamp category on pre-category score rows (gpu:/mem:/tok: prefix).
export const backfillScoreCategories = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("scores").collect();
    let patched = 0;
    for (const row of rows) {
      if (row.category) continue;
      const prefix = row.trackId.split(":")[0];
      const category =
        prefix === "gpu" ? "compute" : prefix === "mem" ? "memory" : prefix === "tok" ? "tokens" : null;
      if (!category) continue;
      await ctx.db.patch(row._id, { category });
      patched += 1;
    }
    return patched;
  },
});
