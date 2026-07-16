import { SiX } from "@icons-pack/react-simple-icons";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import type { RunResult, TrackCategory } from "#/lib/game/types";
import { TRACKS } from "#/lib/game/data";

import { api } from "../../convex/_generated/api";

const PENDING_KEY = "ornn-rider-pending-run";

const CATS: { id: TrackCategory; label: string }[] = [
  { id: "compute", label: "COMPUTE" },
  { id: "memory", label: "MEMORY" },
  { id: "tokens", label: "TOKENS" },
];

// Pixel-theme building blocks matching the game HUD (square, 2px border, hard shadow).
const panel = "border-2 border-[#262626] bg-[#0c0c0c] shadow-[4px_4px_0_rgba(0,0,0,0.65)]";
const btn =
  "pointer-events-auto cursor-pointer border-2 border-[#262626] bg-[#0c0c0c] px-3 py-1.5 " +
  "text-[11px] font-semibold tracking-[0.12em] text-[#909090] transition-colors " +
  "hover:text-[#c8c8c8]";

function loadPendingRun(): RunResult | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as RunResult;
    return typeof run.distance === "number" && typeof run.trackId === "string" ? run : null;
  } catch {
    return null;
  }
}

export function SocialLayer({ lastRun }: { lastRun: RunResult | null }) {
  const { signIn, signOut } = useAuthActions();
  const viewer = useQuery(api.leaderboard.viewer);
  const submitRun = useMutation(api.leaderboard.submitRun);

  const [boardOpen, setBoardOpen] = useState(false);
  const [posted, setPosted] = useState<RunResult | null>(null);
  const submittedRef = useRef<RunResult | null>(null);

  const signedIn = viewer !== undefined && viewer !== null;
  const authLoading = viewer === undefined;

  // Post the finished run once we know the player is signed in. If they are
  // not, stash it so it survives the OAuth redirect and posts after sign-in.
  useEffect(() => {
    const run = lastRun ?? loadPendingRun();
    if (!run || run.distance <= 0 || submittedRef.current === run || authLoading) return;
    if (!signedIn) return;
    submittedRef.current = run;
    localStorage.removeItem(PENDING_KEY);
    submitRun({
      trackId: run.trackId,
      category: run.category,
      range: run.range,
      distance: run.distance,
      coins: run.coins,
      flips: run.flips,
    })
      .then(() => setPosted(run))
      .catch(() => {
        submittedRef.current = null;
      });
  }, [lastRun, signedIn, authLoading, submitRun]);

  function signInWithX() {
    if (lastRun && lastRun.distance > 0 && submittedRef.current !== lastRun) {
      try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(lastRun));
      } catch {
        /* ignore */
      }
    }
    void signIn("twitter");
  }

  // The chip belongs to the results screen; hide it once the player rides again
  // (poll the game's debug handle — its shape is part of the game contract).
  const [onResults, setOnResults] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      const phase = (window as unknown as { __ornn?: { phase?: string } }).__ornn?.phase;
      setOnResults(phase === "crashed" || phase === "finished");
    }, 400);
    return () => clearInterval(id);
  }, []);

  const showRunChip = lastRun !== null && lastRun.distance > 0 && !authLoading && onResults;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 font-['Space_Grotesk_Variable',ui-sans-serif,system-ui,sans-serif]">
      {/* top-right: leaderboard + auth */}
      <div className="absolute top-[18px] right-6 flex items-center gap-2">
        <button type="button" className={btn} onClick={() => setBoardOpen((v) => !v)}>
          LEADERBOARD
        </button>
        {signedIn ? (
          <button
            type="button"
            className={`${btn} flex items-center gap-2`}
            title="sign out"
            onClick={() => void signOut()}
          >
            {viewer.image ? (
              <img src={viewer.image} alt="" className="h-4 w-4 border border-[#262626]" />
            ) : null}
            <span className="max-w-32 truncate normal-case tracking-normal">
              @{viewer.username ?? viewer.name ?? "rider"}
            </span>
          </button>
        ) : authLoading ? null : (
          <button
            type="button"
            className={`${btn} flex items-center gap-2 text-[#e8e8e8]`}
            onClick={signInWithX}
          >
            <SiX size={12} />
            SIGN IN
          </button>
        )}
      </div>

      {/* run-end chip: post status or sign-in nudge */}
      {showRunChip ? (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2">
          {signedIn ? (
            posted === lastRun || submittedRef.current === lastRun ? (
              <button
                type="button"
                className={`${btn} text-[#34d97b]`}
                onClick={() => setBoardOpen(true)}
              >
                SCORE POSTED — VIEW LEADERBOARD
              </button>
            ) : null
          ) : (
            <button
              type="button"
              className={`${btn} flex items-center gap-2 text-[#e8e8e8]`}
              onClick={signInWithX}
            >
              <SiX size={12} />
              SIGN IN WITH X TO POST YOUR SCORE
            </button>
          )}
        </div>
      ) : null}

      {boardOpen ? (
        <Leaderboard initialCategory={lastRun?.category ?? "compute"} onClose={() => setBoardOpen(false)} />
      ) : null}
    </div>
  );
}

function Leaderboard({
  initialCategory,
  onClose,
}: {
  initialCategory: TrackCategory;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<TrackCategory>(initialCategory);
  const [trackId, setTrackId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = useQuery(api.leaderboard.topRuns, {
    category,
    trackId: trackId ?? undefined,
    limit: 25,
  });

  const prefix = { compute: "gpu", memory: "mem", tokens: "tok" }[category];
  const tracks = TRACKS.filter((t) => t.category === category);

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/70">
      <div className={`${panel} flex max-h-[80vh] w-[620px] max-w-[94vw] flex-col p-5`}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[13px] font-bold tracking-[0.18em] text-[#e8e8e8]">
            LEADERBOARD
          </div>
          <button
            type="button"
            className="cursor-pointer text-[13px] text-[#909090] hover:text-[#e8e8e8]"
            onClick={onClose}
          >
            [ESC] CLOSE
          </button>
        </div>

        <div className="mb-2 flex gap-2">
          {CATS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${btn} ${category === c.id ? "border-[#e8e8e8] text-[#e8e8e8]" : ""}`}
              onClick={() => {
                setCategory(c.id);
                setTrackId(null);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`${btn} px-2 py-1 text-[10px] ${trackId === null ? "border-[#e8e8e8] text-[#e8e8e8]" : ""}`}
            onClick={() => setTrackId(null)}
          >
            ALL
          </button>
          {tracks.map((t) => {
            const id = `${prefix}:${t.apiId}`;
            return (
              <button
                key={t.id}
                type="button"
                className={`${btn} px-2 py-1 text-[10px] ${trackId === id ? "border-[#e8e8e8] text-[#e8e8e8]" : ""}`}
                onClick={() => setTrackId(id)}
              >
                {t.tab.toUpperCase()}
              </button>
            );
          })}
        </div>

        <div className="min-h-40 overflow-y-auto">
          {rows === undefined ? (
            <div className="py-8 text-center text-[12px] text-[#909090]">loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[#909090]">
              no runs yet — be the first
            </div>
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[10px] tracking-[0.12em] text-[#909090]">
                  <th className="py-1.5 pr-2 font-semibold">#</th>
                  <th className="py-1.5 pr-2 font-semibold">RIDER</th>
                  {trackId === null ? <th className="py-1.5 pr-2 font-semibold">TRACK</th> : null}
                  <th className="py-1.5 pr-2 text-right font-semibold">DIST</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">COINS</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">FLIPS</th>
                  <th className="py-1.5 text-right font-semibold">SCORE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.rank}`} className="border-t-2 border-[#1a1a1a] text-[#c8c8c8]">
                    <td className={`py-2 pr-2 ${r.rank === 1 ? "text-[#f5a524]" : "text-[#909090]"}`}>
                      {r.rank}
                    </td>
                    <td className="py-2 pr-2">
                      <span className="flex items-center gap-2">
                        {r.image ? (
                          <img src={r.image} alt="" className="h-4 w-4 border border-[#262626]" />
                        ) : null}
                        <span className="max-w-40 truncate">
                          {r.username ? `@${r.username}` : r.name}
                        </span>
                      </span>
                    </td>
                    {trackId === null ? (
                      <td className="py-2 pr-2 text-[#909090]">{r.trackId.split(":")[1]}</td>
                    ) : null}
                    <td className="py-2 pr-2 text-right tabular-nums">{r.distance}m</td>
                    <td className="py-2 pr-2 text-right text-[#f5a524] tabular-nums">{r.coins}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.flips}</td>
                    <td className="py-2 text-right font-semibold text-[#34d97b] tabular-nums">
                      {r.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
