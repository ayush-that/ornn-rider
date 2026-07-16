import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  // authTables.users plus the X handle captured at sign-in.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    username: v.optional(v.string()),
  }).index("email", ["email"]),
  scores: defineTable({
    userId: v.optional(v.id("users")),
    // Legacy field from an earlier prototype's anonymous runs; new rows never set it.
    anonName: v.optional(v.string()),
    // "gpu:H100 SXM" | "mem:DDR5 16Gb (2Gx8) 4800/5600" | "tok:anthropic"
    trackId: v.string(),
    category: v.optional(
      v.union(v.literal("compute"), v.literal("memory"), v.literal("tokens")),
    ),
    range: v.optional(v.string()),
    distance: v.number(),
    coins: v.number(),
    flips: v.number(),
    timeMs: v.optional(v.number()),
    score: v.number(),
    createdAt: v.number(),
  })
    .index("by_track_score", ["trackId", "score"])
    .index("by_category_score", ["category", "score"])
    .index("by_user", ["userId"]),
});
