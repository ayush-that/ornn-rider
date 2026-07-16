import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SocialLayer } from "#/components/social-layer";
import type { RunResult } from "#/lib/game/types";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    meta: [
      { title: "Ornn Rider" },
      {
        name: "description",
        content: "Ride the compute market — a bike over real GPU price charts.",
      },
    ],
  }),
});

function HomePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = uiRef.current;
    if (!canvas || !root) return;

    // No scrollbars while the game owns the viewport; restored on unmount.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    let cancelled = false;
    let stop: (() => void) | null = null;

    // Dynamic import keeps matter-js / window / canvas code off the server.
    import("#/lib/game/game").then((mod) => {
      if (cancelled || !canvasRef.current || !uiRef.current) return;
      mod.startGame(canvasRef.current, uiRef.current, { onRunEnd: setLastRun });
      stop = mod.stopGame;
    });

    return () => {
      cancelled = true;
      stop?.();
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#050505]">
      {/* Canvas fills the viewport; the game handles its own DPR-aware resize. */}
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />

      {/* The game's own DOM header + HUD (branding, GPU tabs, price block,
          stats, results) mounts here. It owns all on-screen chrome. */}
      <div ref={uiRef} className="pointer-events-none fixed inset-0" />

      {/* React layer: X sign-in, score submission, leaderboards (Convex). */}
      <SocialLayer lastRun={lastRun} />
    </div>
  );
}
