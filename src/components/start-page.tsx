const startBtn =
  "pointer-events-auto cursor-pointer border-2 bg-[#0c0c0c] px-10 py-3 text-[13px] " +
  "font-bold tracking-[0.18em] shadow-[4px_4px_0_rgba(0,0,0,0.65)] transition-colors " +
  "font-['Space_Mono',ui-monospace,monospace]";

export function StartPage({ onStart, onLeaderboard }: { onStart: () => void; onLeaderboard: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex overflow-y-auto bg-[#050505]">
      {/* m-auto centers when content fits and allows scrolling when it doesn't
          (short landscape viewports used to clip the buttons unreachably). */}
      <div className="m-auto flex flex-col items-center gap-8 py-10">
        <img
          src="/logo.png"
          alt="Engineer Boyfriend"
          className="max-h-[42vh] w-[min(420px,72vw)] select-none object-contain"
          draggable={false}
        />
      <p className="pointer-events-auto max-w-[520px] px-6 text-center font-['Space_Mono',ui-monospace,monospace] text-[13px] leading-relaxed text-[#909090]">
        Your girlfriend needs GPU clusters for her AI startup — and compute is not
        cheap. Be the engineer boyfriend: ride the live markets, collect chips, and
        secure the compute.
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
        <p className="pointer-events-auto mt-2 font-['Space_Mono',ui-monospace,monospace] text-[11px] tracking-[0.06em] text-[#5a5a5a]">
          data sourced from{" "}
          <a
            href="https://ornn.com"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-[#909090]"
          >
            ornn.com
          </a>
        </p>
        <p className="pointer-events-auto font-['Space_Mono',ui-monospace,monospace] text-[11px] tracking-[0.06em] text-[#5a5a5a]">
          inspired by{" "}
          <a
            href="https://stonkrider.com"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-[#909090]"
          >
            stonkrider.com
          </a>
        </p>
        </div>
      </div>
    </div>
  );
}
