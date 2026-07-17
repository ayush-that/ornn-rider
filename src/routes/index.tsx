import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SocialLayer } from "#/components/social-layer";
import type { RunResult } from "#/lib/game/types";

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
  const [boardSignal, setBoardSignal] = useState(0);

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

      {started ? null : (
        <StartPage
          onStart={() => setStarted(true)}
          onLeaderboard={() => setBoardSignal((n) => n + 1)}
        />
      )}
    </div>
  );
}

const startBtn =
  "pointer-events-auto cursor-pointer border-2 bg-[#0c0c0c] px-10 py-3 text-[13px] " +
  "font-bold tracking-[0.18em] shadow-[4px_4px_0_rgba(0,0,0,0.65)] transition-colors " +
  "font-['Space_Grotesk_Variable',ui-sans-serif,system-ui,sans-serif]";

function StartPage({ onStart, onLeaderboard }: { onStart: () => void; onLeaderboard: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-8 bg-[#050505]">
      <img
        src="/logo.png"
        alt="Engineer Boyfriend"
        className="w-[min(420px,72vw)] select-none"
        draggable={false}
      />
      <p className="pointer-events-auto max-w-[520px] px-6 text-center font-['Space_Grotesk_Variable',ui-sans-serif,system-ui,sans-serif] text-[13px] leading-relaxed text-[#909090]">
        Every hill is a real market chart — GPU rental prices, DRAM spot prices, and
        LLM token indices, full history. Ride the candles, grab points and nitro,
        and chain flips and wheelies for streaks.
      </p>
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          className={`${startBtn} border-[#34d97b] text-[#34d97b] hover:bg-[#34d97b] hover:text-[#050505]`}
          onClick={onStart}
        >
          START GAME
        </button>
        <button
          type="button"
          className={`${startBtn} border-[#262626] text-[#909090] hover:text-[#e8e8e8]`}
          onClick={onLeaderboard}
        >
          LEADERBOARD
        </button>
      </div>
    </div>
  );
}
