import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

const CATEGORY = v.union(v.literal("compute"), v.literal("memory"), v.literal("tokens"));

// Same formula the game HUD shows: distance + coin and flip bonuses.
function computeScore(distance: number, coins: number, flips: number): number {
  return Math.round(distance + coins * 100 + flips * 500);
}

export const submitRun = mutation({
  args: {
    trackId: v.string(),
    category: CATEGORY,
    range: v.optional(v.string()),
    distance: v.number(),
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
    const score = computeScore(distance, coins, flips);
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

export const topRuns = query({
  args: {
    category: CATEGORY,
    trackId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { category, trackId, limit }) => {
    const n = Math.min(limit ?? 25, 100);
    // Over-fetch, then keep each user's best run so one player can't fill the board.
    const rows =
      trackId !== undefined
        ? await ctx.db
            .query("scores")
            .withIndex("by_track_score", (q) => q.eq("trackId", trackId))
            .order("desc")
            .take(n * 10)
        : await ctx.db
            .query("scores")
            .withIndex("by_category_score", (q) => q.eq("category", category))
            .order("desc")
            .take(n * 10);

    const seen = new Set<string>();
    const top: typeof rows = [];
    for (const row of rows) {
      const key = row.userId ?? row._id;
      if (seen.has(key)) continue;
      seen.add(key);
      top.push(row);
      if (top.length >= n) break;
    }

    return Promise.all(
      top.map(async (row, i) => {
        const user = row.userId ? await ctx.db.get(row.userId) : null;
        return {
          rank: i + 1,
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
