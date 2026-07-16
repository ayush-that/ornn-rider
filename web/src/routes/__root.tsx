import { ConvexAuthProvider } from "@convex-dev/auth/react";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";

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
        title: "Ornn Rider",
      },
      {
        name: "description",
        content: "Ride the compute market — a bike over real GPU, memory, and token price charts.",
      },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg" },
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
