import { createFileRoute } from "@tanstack/react-router";

// The Ornn API (api.ornnai.com) only serves CORS headers to whitelisted
// origins, so the browser cannot fetch it directly. This catch-all server
// route proxies GET /api/* to the upstream API in both dev and production.
// The game's data layer fetches relative /api/... paths (see lib/game/data.ts).
const UPSTREAM = "https://api.ornnai.com";

// Per-GPU history endpoints (/api/gpu/<name>/history-simple, /index-history)
// require a bearer token. It is injected here, server-side only, and never
// reaches the client. Public paths (e.g. /api/h100-history) work without it.
function needsAuth(pathname: string): boolean {
  return pathname.startsWith("/api/gpu/");
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = UPSTREAM + url.pathname + url.search;

        const headers: Record<string, string> = { accept: "application/json" };
        const apiKey = process.env.ORNN_API_KEY;
        if (apiKey && needsAuth(url.pathname)) {
          headers.authorization = `Bearer ${apiKey}`;
        }

        const upstream = await fetch(target, { headers });

        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "application/json",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
