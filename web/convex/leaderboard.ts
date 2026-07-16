import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

const CATEGORY = v.union(v.literal("compute"), v.literal("memory"), v.literal("tokens"));

export const submitRun = mutation({
  args: {
    trackId: v.string(),
    category: CATEGORY,
    range: v.optional(v.string()),
    distance: v.number(),
    // Points collected in the run (pickups + flip bonuses). Kept under the
    // legacy `coins` field name to avoid a schema migration.
    coins: v.number(),
    flips: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in with X to post to the leaderboard");
    // ponytail: sanity clamps only, no replay verification — revisit if scores get gamed
    const distance = Math.max(0, Math.min(Math.round(args.distance), 1_000_000));
    const coins = Math.max(0, Math.min(Math.round(args.coins), 100_000));
    const flips = Math.max(0, Math.min(Math.round(args.flips), 10_000));
    // The leaderboard ranks by points, full stop.
    const score = coins;
    await ctx.db.insert("scores", {
      userId,
      trackId: args.trackId,
      category: args.category,
      range: args.range,
      distance,
      coins,
      flips,
      score,
      createdAt: Date.now(),
    });
    return score;
  },
});

// Cursor-paginated, score-descending. Per-user dedup happens client-side over
// the accumulated pages (dedup can't cross a server cursor boundary), so each
// row carries a stable `key` for it.
export const topRuns = query({
  args: {
    category: CATEGORY,
    trackId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { category, trackId, paginationOpts }) => {
    const result =
      trackId !== undefined
        ? await ctx.db
            .query("scores")
            .withIndex("by_track_score", (q) => q.eq("trackId", trackId))
            .order("desc")
            .paginate(paginationOpts)
        : await ctx.db
            .query("scores")
            .withIndex("by_category_score", (q) => q.eq("category", category))
            .order("desc")
            .paginate(paginationOpts);

    const page = await Promise.all(
      result.page.map(async (row) => {
        const user = row.userId ? await ctx.db.get(row.userId) : null;
        return {
          key: row.userId ?? row._id,
          name: user?.name ?? row.anonName ?? "anon",
          username: user?.username ?? null,
          image: user?.image ?? null,
          trackId: row.trackId,
          distance: row.distance,
          coins: row.coins,
          flips: row.flips,
          score: row.score,
          createdAt: row.createdAt,
        };
      }),
    );
    return { ...result, page };
  },
});

export const myBest = query({
  args: { category: v.optional(CATEGORY) },
  handler: async (ctx, { category }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const mine = category ? rows.filter((r) => r.category === category) : rows;
    const best: Record<string, number> = {};
    for (const r of mine) {
      if ((best[r.trackId] ?? 0) < r.score) best[r.trackId] = r.score;
    }
    return best;
  },
});

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return { name: user.name ?? null, username: user.username ?? null, image: user.image ?? null };
  },
});
