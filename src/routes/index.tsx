import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SocialLayer } from "#/components/social-layer";
import { StartPage } from "#/components/start-page";
import { TrackPicker } from "#/components/track-picker";
import type { Track, RunResult } from "#/lib/game/types";

// Dynamic import keeps matter-js / window / canvas code off the server;
// hoisted to module level so the React Compiler can optimize HomePage.
const loadGame = () => import("#/lib/game/game");

export const Route = createFileRoute("/")({
  component: HomePage,
  // Deep links (?track=...) skip the start page straight into the game.
  validateSearch: (search: Record<string, unknown>): { track?: string } =>
    typeof search.track === "string" ? { track: search.track } : {},
  head: () => ({
    meta: [
      { title: "Engineer Boyfriend — ride the AI market" },
      {
        name: "description",
        content:
          "Hill-climb a dirt bike over real GPU, memory, and token price charts. Post your run to the leaderboard with X.",
      },
    ],
  }),
});

function HomePage() {
  const { track } = Route.useSearch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [started, setStarted] = useState(track !== undefined);
  const [picking, setPicking] = useState(false);
  const [boardSignal, setBoardSignal] = useState(0);

  function pickTrack(t: Track) {
    // The game boots from the ?track deep link, so picking = setting the link.
    const url = new URL(window.location.href);
    url.searchParams.set("track", t.id);
    window.history.replaceState(null, "", url);
    setPicking(false);
    setStarted(true);
  }

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    const root = uiRef.current;
    if (!canvas || !root) return;

    // No scrollbars while the game owns the viewport; restored on unmount.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    let cancelled = false;
    let stop: (() => void) | null = null;

    loadGame().then((mod) => {
      if (cancelled || !canvasRef.current || !uiRef.current) return;
      mod.startGame(canvasRef.current, uiRef.current, { onRunEnd: setLastRun });
      stop = mod.stopGame;
    });

    return () => {
      cancelled = true;
      stop?.();
      document.body.style.overflow = prevOverflow;
    };
  }, [started]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#050505]">
      {/* Canvas fills the viewport; the game handles its own DPR-aware resize. */}
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />

      {/* The game's own DOM header + HUD (branding, GPU tabs, price block,
          stats, results) mounts here. It owns all on-screen chrome. */}
      <div ref={uiRef} className="pointer-events-none fixed inset-0" />

      {/* React layer: X sign-in, score submission, leaderboards (Convex). */}
      <SocialLayer lastRun={lastRun} boardSignal={boardSignal} />

      {started ? null : picking ? (
        <TrackPicker onPick={pickTrack} onBack={() => setPicking(false)} />
      ) : (
        <StartPage
          onStart={() => setPicking(true)}
          onLeaderboard={() => setBoardSignal((n) => n + 1)}
        />
      )}
    </div>
  );
}
