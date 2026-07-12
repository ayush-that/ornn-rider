// DOM overlay: the Ornn chart product header (logo, GPU tabs = track selector,
// price block + range pills) plus minimal in-run stat readouts and a restyled
// results card. All CSS injected here.
import type { GameState, Track, GpuRange } from './types'
import { C } from './types'
import { RANGES } from './data'

const CSS = `
#ornn-hud, #ornn-hud * { box-sizing: border-box; margin: 0; padding: 0; }
#ornn-hud {
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: ${C.text};
  -webkit-font-smoothing: antialiased;
  user-select: none;
}
.oh-mono { font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }

/* ---- header ---- */
#oh-header { position: absolute; top: 0; left: 0; right: 0; padding: 14px 20px 10px; }
#oh-top { display: flex; align-items: center; justify-content: space-between; }
#oh-brand { display: flex; align-items: center; gap: 9px; }
#oh-brand svg { display: block; }
#oh-brand .oh-word { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; color: ${C.text}; }
#oh-lead { font-size: 13px; color: ${C.dim}; pointer-events: auto; cursor: default; }

#oh-tabs { display: flex; gap: 22px; margin-top: 14px; }
.oh-tab {
  pointer-events: auto; cursor: pointer; background: none; border: none;
  font-family: inherit; font-size: 13px; color: ${C.dim};
  padding: 0 0 7px; position: relative; transition: color .12s;
}
.oh-tab:hover { color: #b8b8b8; }
.oh-tab.active { color: ${C.text}; font-weight: 600; }
.oh-tab.active::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: ${C.text};
}
#oh-tabline { height: 1px; background: ${C.grid}; margin: 0 -20px; }

#oh-priceblock { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
#oh-price { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
#oh-price .oh-hr { font-size: 14px; font-weight: 400; color: ${C.dim}; margin-left: 4px; }
#oh-change {
  font-size: 12px; font-weight: 500; padding: 3px 8px; border-radius: 5px;
  font-variant-numeric: tabular-nums;
}
#oh-change.up { color: ${C.chgUpText}; background: ${C.chgUpBg}; }
#oh-change.down { color: ${C.chgDownText}; background: ${C.chgDownBg}; }
#oh-ranges { display: flex; gap: 4px; margin-left: 4px; }
.oh-pill {
  pointer-events: auto; cursor: pointer; background: none; border: none;
  font-family: inherit; font-size: 12px; font-weight: 500; color: ${C.dim};
  padding: 4px 10px; border-radius: 6px; transition: background .12s, color .12s;
}
.oh-pill:hover { color: #b8b8b8; }
.oh-pill.active { color: ${C.text}; background: #1c1c1c; }
.oh-hidden { display: none !important; }

/* ---- in-run stats (minimal, bottom) ---- */
#oh-stats {
  position: absolute; left: 20px; bottom: 16px; display: flex; gap: 20px;
}
#oh-stats .oh-stat { display: flex; flex-direction: column; gap: 2px; }
#oh-stats .oh-k { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.dim}; }
#oh-stats .oh-v { font-size: 15px; color: ${C.text}; }
#oh-stats .oh-v.cred { color: ${C.amber}; }
#oh-speed { position: absolute; right: 20px; bottom: 16px; text-align: right; }
#oh-speed .oh-k { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.dim}; }
#oh-speed .oh-v { font-size: 18px; color: ${C.text}; }
#oh-speed .oh-v span { font-size: 11px; color: ${C.dim}; }
#oh-hint {
  position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%);
  font-size: 12px; color: ${C.dim}; letter-spacing: 0.04em;
  transition: opacity .3s; text-align: center;
}
#oh-hint b { color: ${C.text}; background: #161616; border-radius: 4px; padding: 2px 6px; margin: 0 1px; }

/* ---- results ---- */
#oh-results {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  pointer-events: auto; background: rgba(5,5,5,0.72);
}
.oh-rescard {
  width: 320px; background: ${C.panel}; border-radius: 14px; padding: 24px 26px; text-align: center;
}
.oh-restitle { font-size: 15px; font-weight: 600; letter-spacing: 0.14em; margin-bottom: 16px; }
.oh-restitle.crashed { color: ${C.chgDownText}; }
.oh-restitle.finished { color: ${C.chgUpText}; }
.oh-resgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
.oh-rescell { background: #111; border-radius: 8px; padding: 12px; }
.oh-rescell .oh-k { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.dim}; }
.oh-rescell .oh-v { font-size: 18px; font-weight: 600; margin-top: 4px; }
.oh-newbest { font-size: 11px; color: ${C.amber}; letter-spacing: 0.1em; margin-bottom: 12px; min-height: 14px; }
.oh-btnrow { display: flex; gap: 10px; }
.oh-btn {
  flex: 1; font-family: inherit; font-size: 12px; font-weight: 500; letter-spacing: 0.06em;
  padding: 10px 0; border-radius: 8px; cursor: pointer; border: none; transition: filter .12s;
}
.oh-btn:hover { filter: brightness(1.25); }
.oh-btn.primary { background: ${C.text}; color: ${C.chipText}; }
.oh-btn.ghost { background: #1c1c1c; color: ${C.dim}; }

/* ---- loading ---- */
#oh-loading {
  position: absolute; left: 50%; top: 55%; transform: translate(-50%,-50%);
  font-size: 13px; letter-spacing: 0.06em; color: ${C.dim};
  display: flex; align-items: center; gap: 10px;
}
#oh-loading .oh-dot {
  width: 7px; height: 7px; border-radius: 50%; background: ${C.text};
  animation: oh-pulse 0.9s ease-in-out infinite;
}
@keyframes oh-pulse { 0%,100% { opacity: 0.25; } 50% { opacity: 1; } }
`

// Layered-diamond Ornn glyph, white.
const LOGO_SVG = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 1.5 18 6 10 10.5 2 6 10 1.5Z" fill="#fff" opacity="0.95"/>
  <path d="M2 10 10 14.5 18 10" stroke="#fff" stroke-width="1.4" opacity="0.6"/>
  <path d="M2 13.6 10 18 18 13.6" stroke="#fff" stroke-width="1.4" opacity="0.32"/>
</svg>`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}

function fmtBest(px: number): string {
  return px > 0 ? `${Math.round(px / 10).toLocaleString('en-US')} m` : '—'
}

export function createHud(
  root: HTMLElement,
  tracks: Track[],
  onSelect: (track: Track, range: GpuRange) => void,
) {
  if (!document.getElementById('ornn-hud-style')) {
    const style = document.createElement('style')
    style.id = 'ornn-hud-style'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  const hud = el('div', '')
  hud.id = 'ornn-hud'
  root.appendChild(hud)

  let curTrackId = ''
  let curRange: GpuRange = '3m'

  // ---- header ----
  const header = el('div', '')
  header.id = 'oh-header'
  header.innerHTML = `
    <div id="oh-top">
      <div id="oh-brand">${LOGO_SVG}<span class="oh-word">Ornn</span></div>
      <div id="oh-lead">Leaderboard (soon)</div>
    </div>
    <div id="oh-tabs"></div>
    <div id="oh-tabline"></div>
    <div id="oh-priceblock">
      <div id="oh-price" class="oh-mono">$0.00<span class="oh-hr">/hr</span></div>
      <div id="oh-change" class="up oh-mono">+0.00%</div>
      <div id="oh-ranges"></div>
    </div>`
  hud.appendChild(header)

  const tabsEl = header.querySelector<HTMLElement>('#oh-tabs')!
  const priceEl = header.querySelector<HTMLElement>('#oh-price')!
  const changeEl = header.querySelector<HTMLElement>('#oh-change')!
  const rangesEl = header.querySelector<HTMLElement>('#oh-ranges')!

  const tabBtns = new Map<string, HTMLButtonElement>()
  for (const track of tracks) {
    const b = el('button', 'oh-tab')
    b.type = 'button'
    b.textContent = track.tab
    b.addEventListener('click', () => {
      const range: GpuRange = curRange === 'all' && !track.hasAll ? '3m' : curRange
      onSelect(track, range)
    })
    tabsEl.appendChild(b)
    tabBtns.set(track.id, b)
  }

  const pillBtns = new Map<GpuRange, HTMLButtonElement>()
  for (const r of RANGES) {
    const b = el('button', 'oh-pill')
    b.type = 'button'
    b.textContent = r.label
    b.addEventListener('click', () => {
      const track = tracks.find(t => t.id === curTrackId)
      if (track) onSelect(track, r.id)
    })
    rangesEl.appendChild(b)
    pillBtns.set(r.id, b)
  }

  function setActive(trackId: string, range: GpuRange, hasAll: boolean): void {
    curTrackId = trackId
    curRange = range
    for (const [id, b] of tabBtns) b.classList.toggle('active', id === trackId)
    for (const [id, b] of pillBtns) {
      b.classList.toggle('active', id === range)
      b.classList.toggle('oh-hidden', id === 'all' && !hasAll)
    }
  }

  function setHeader(price: number, changePct: number): void {
    priceEl.innerHTML = `$${price.toFixed(2)}<span class="oh-hr">/hr</span>`
    const up = changePct >= 0
    changeEl.textContent = `${up ? '+' : ''}${changePct.toFixed(2)}%`
    changeEl.className = `${up ? 'up' : 'down'} oh-mono`
  }

  // ---- in-run stats ----
  const stats = el('div', '')
  stats.id = 'oh-stats'
  stats.innerHTML = `
    <div class="oh-stat"><span class="oh-k">Distance</span><span class="oh-v oh-mono" data-k="dist">0 m</span></div>
    <div class="oh-stat"><span class="oh-k">Credits</span><span class="oh-v cred oh-mono" data-k="cred">0</span></div>
    <div class="oh-stat"><span class="oh-k">Best</span><span class="oh-v oh-mono" data-k="best">—</span></div>`
  const sDist = stats.querySelector<HTMLElement>('[data-k="dist"]')!
  const sCred = stats.querySelector<HTMLElement>('[data-k="cred"]')!
  const sBest = stats.querySelector<HTMLElement>('[data-k="best"]')!

  const speed = el('div', '')
  speed.id = 'oh-speed'
  speed.innerHTML = `<div class="oh-k">Speed</div><div class="oh-v oh-mono">0 <span>km/h</span></div>`
  const sSpeed = speed.querySelector<HTMLElement>('.oh-v')!
  const sSpeedText = sSpeed.firstChild as Text

  const hint = el('div', '')
  hint.id = 'oh-hint'
  hint.innerHTML = 'Press <b>→</b> to ride'

  hud.appendChild(stats)
  hud.appendChild(speed)
  hud.appendChild(hint)

  // ---- results + loading ----
  const results = el('div', 'oh-hidden')
  results.id = 'oh-results'
  const loading = el('div', 'oh-hidden')
  loading.id = 'oh-loading'
  loading.innerHTML = `<div class="oh-dot"></div><span></span>`
  const loadingMsg = loading.querySelector<HTMLElement>('span')!
  hud.appendChild(results)
  hud.appendChild(loading)

  // dirty-check caches
  let lastDist = -1, lastCred = -1, lastBest = -1, lastSpeed = -1, hintHidden = false

  function update(state: GameState): void {
    if (!state.terrain || !state.bike) return
    // Hide the ride hint once the run has begun.
    if (state.started && !hintHidden) { hintHidden = true; hint.style.opacity = '0' }
    if (!state.started && hintHidden) { hintHidden = false; hint.style.opacity = '1' }

    const dist = Math.round(state.distance / 10)
    if (dist !== lastDist) { lastDist = dist; sDist.textContent = `${dist} m` }
    if (state.credits !== lastCred) { lastCred = state.credits; sCred.textContent = String(state.credits) }
    const best = state.track ? (state.bestDistance[state.track.id] ?? 0) : 0
    if (best !== lastBest) { lastBest = best; sBest.textContent = fmtBest(best) }
    const spd = Math.round(state.bike.speed * 0.36)
    if (spd !== lastSpeed) { lastSpeed = spd; sSpeedText.nodeValue = `${spd} ` }
  }

  function showResults(state: GameState, onRetry: () => void): void {
    const finished = state.phase === 'finished'
    const distM = Math.round(state.distance / 10)
    results.innerHTML = ''
    const card = el('div', 'oh-rescard')
    card.innerHTML = `
      <div class="oh-restitle ${finished ? 'finished' : 'crashed'}">${finished ? 'FINISH' : 'CRASHED'}</div>
      <div class="oh-newbest">${state.newBest ? '★ NEW BEST' : ''}</div>
      <div class="oh-resgrid">
        <div class="oh-rescell"><div class="oh-k">Distance</div><div class="oh-v oh-mono">${distM.toLocaleString('en-US')} m</div></div>
        <div class="oh-rescell"><div class="oh-k">Credits</div><div class="oh-v oh-mono" style="color:${C.amber}">${state.credits}</div></div>
        <div class="oh-rescell"><div class="oh-k">Flips</div><div class="oh-v oh-mono">${state.flips}</div></div>
        <div class="oh-rescell"><div class="oh-k">Air time</div><div class="oh-v oh-mono">${(state.airTimeMs / 1000).toFixed(1)}s</div></div>
      </div>
      <div class="oh-btnrow"><button type="button" class="oh-btn primary">Retry (R)</button></div>`
    card.querySelector<HTMLButtonElement>('.oh-btn')!.addEventListener('click', onRetry)
    results.appendChild(card)
    results.classList.remove('oh-hidden')
  }

  function hideResults(): void {
    results.classList.add('oh-hidden')
  }

  function setLoading(msg: string | null): void {
    if (msg === null) {
      loading.classList.add('oh-hidden')
    } else {
      loadingMsg.textContent = msg
      loading.classList.remove('oh-hidden')
    }
  }

  return { update, setActive, setHeader, showResults, hideResults, setLoading }
}
