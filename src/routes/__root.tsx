import { ConvexAuthProvider } from "@convex-dev/auth/react";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";

import { env } from "#/env/client";
import { convex } from "#/lib/convex";

import appCss from "#/styles.css?url";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Engineer Boyfriend — ride the AI market",
      },
      {
        name: "description",
        content: "Hill-climb a dirt bike over real GPU, memory, and token price charts. Post your run to the leaderboard with X.",
      },
      { property: "og:title", content: "Engineer Boyfriend" },
      { property: "og:description", content: "Ride the AI market. Real GPU, memory, and token price charts as terrain." },
      { property: "og:image", content: "https://engineerboyfriend.com/og-banner.png" },
      { property: "og:url", content: "https://engineerboyfriend.com" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Engineer Boyfriend" },
      { name: "twitter:description", content: "Ride the AI market. Real GPU, memory, and token price charts as terrain." },
      { name: "twitter:image", content: "https://engineerboyfriend.com/og-banner.png" },
    ],
    links: [
      // Warm up DNS/TCP/TLS to the Convex deployment before the client connects.
      { rel: "preconnect", href: env.VITE_CONVEX_URL },
      { rel: "icon", href: "/favicon.png" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
