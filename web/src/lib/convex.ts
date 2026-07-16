import { ConvexReactClient } from "convex/react";

import { env } from "#/env/client";

// Singleton Convex client; connection is lazy so creating it during SSR is fine.
export const convex = new ConvexReactClient(env.VITE_CONVEX_URL);
