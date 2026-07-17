import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SocialLayer } from "#/components/social-layer";
import { CATEGORIES } from "#/lib/game/data";
import type { Track, RunResult, TrackCategory } from "#/lib/game/types";

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

const startBtn =
  "pointer-events-auto cursor-pointer border-2 bg-[#0c0c0c] px-10 py-3 text-[13px] " +
  "font-bold tracking-[0.18em] shadow-[4px_4px_0_rgba(0,0,0,0.65)] transition-colors " +
  "font-['Space_Mono',ui-monospace,monospace]";

function StartPage({ onStart, onLeaderboard }: { onStart: () => void; onLeaderboard: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-8 bg-[#050505]">
      <img
        src="/logo.png"
        alt="Engineer Boyfriend"
        className="w-[min(420px,72vw)] select-none"
        draggable={false}
      />
      <p className="pointer-events-auto max-w-[520px] px-6 text-center font-['Space_Mono',ui-monospace,monospace] text-[13px] leading-relaxed text-[#909090]">
        Your girlfriend needs GPU clusters for her AI startup — and compute is not
        cheap. Be the engineer boyfriend: ride the live markets, collect chips, and
        secure the compute. Every hill is a real chart — GPU rentals, DRAM spot
        prices, and LLM token indices, full history.{" "}
        <a
          href="https://ornn.com"
          target="_blank"
          rel="noreferrer"
          className="text-[#34d97b] hover:underline"
        >
          Data by ornn.com
        </a>
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

const CAT_LABELS: { id: TrackCategory; label: string }[] = [
  { id: "compute", label: "COMPUTE" },
  { id: "memory", label: "MEMORY" },
  { id: "tokens", label: "TOKENS" },
];

function TrackPicker({ onPick, onBack }: { onPick: (t: Track) => void; onBack: () => void }) {
  const [cat, setCat] = useState<TrackCategory>("compute");
  const tracks = CATEGORIES.find((c) => c.id === cat)?.tracks ?? [];
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-[#050505] px-4 font-['Space_Mono',ui-monospace,monospace]">
      <div className="text-[13px] font-bold tracking-[0.2em] text-[#e8e8e8]">PICK YOUR MARKET</div>
      <div className="flex gap-2">
        {CAT_LABELS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`pointer-events-auto cursor-pointer border-2 bg-[#0c0c0c] px-4 py-2 text-[11px] font-semibold tracking-[0.14em] transition-colors ${
              cat === c.id ? "border-[#34d97b] text-[#34d97b]" : "border-[#262626] text-[#909090] hover:text-[#c8c8c8]"
            }`}
            onClick={() => setCat(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex max-w-[560px] flex-wrap items-center justify-center gap-2">
        {tracks.map((t) => (
          <button
            key={t.id}
            type="button"
            className="pointer-events-auto cursor-pointer border-2 border-[#262626] bg-[#0c0c0c] px-4 py-2.5 text-[12px] font-semibold tracking-[0.08em] text-[#c8c8c8] shadow-[3px_3px_0_rgba(0,0,0,0.65)] transition-colors hover:border-[#34d97b] hover:text-[#34d97b]"
            onClick={() => onPick(t)}
          >
            {t.tab}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="pointer-events-auto cursor-pointer text-[11px] tracking-[0.14em] text-[#909090] hover:text-[#e8e8e8]"
        onClick={onBack}
      >
        ← BACK
      </button>
    </div>
  );
}
