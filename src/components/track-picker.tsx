import { useState } from "react";

import { CATEGORIES } from "#/lib/game/data";
import type { Track, TrackCategory } from "#/lib/game/types";

const CAT_LABELS: { id: TrackCategory; label: string }[] = [
  { id: "compute", label: "COMPUTE" },
  { id: "memory", label: "MEMORY" },
  { id: "tokens", label: "TOKENS" },
];

export function TrackPicker({ onPick, onBack }: { onPick: (t: Track) => void; onBack: () => void }) {
  const [cat, setCat] = useState<TrackCategory>("compute");
  const tracks = CATEGORIES.find((c) => c.id === cat)?.tracks ?? [];
  return (
    <div className="absolute inset-0 z-10 flex overflow-y-auto bg-[#050505] px-4 font-['Space_Mono',ui-monospace,monospace]">
      {/* m-auto centers when content fits and scrolls when it doesn't (short
          landscape viewports). */}
      <div className="m-auto flex flex-col items-center gap-6 py-10">
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
    </div>
  );
}
