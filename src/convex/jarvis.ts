import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Log one local command handled by the JARVIS console. */
export const logCommand = mutation({
  args: {
    input: v.string(),
    inputMode: v.union(v.literal("text"), v.literal("voice")),
    intent: v.optional(v.string()),
    toolName: v.optional(v.string()),
    response: v.optional(v.string()),
    ok: v.boolean(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    await ctx.db.insert("commandLogs", { userId, ...args });
  },
});

/** Recent command history for the current user (newest first). */
export const recentCommands = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    return await ctx.db
      .query("commandLogs")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit ?? 40);
  },
});

/** Count of commands handled in this console (for the sidebar stat). */
export const commandCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const rows = await ctx.db
      .query("commandLogs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.length;
  },
});
