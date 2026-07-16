// DOM overlay: the Ornn chart product header (logo, GPU tabs = track selector,
// price block + range pills) plus minimal in-run stat readouts and a restyled
// results card. All CSS injected here.
import type { GameState, Track, GpuRange } from './types'
import { C } from './types'
import type { Category } from './data'
import { RANGE_LABELS, categoryOf, defaultRange } from './data'

const CSS = `
#ornn-hud, #ornn-hud * { box-sizing: border-box; margin: 0; padding: 0; }
#ornn-hud {
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font-family: 'Space Grotesk Variable', ui-sans-serif, system-ui, sans-serif;
  color: ${C.text};
  line-height: 1.4; letter-spacing: 0.01em; word-spacing: 0.04em;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}
.oh-mono { font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }

/* pixel-theme panel: square, 2px border, hard offset shadow */
.oh-panel {
  background: #0c0c0c; border: 2px solid #262626; border-radius: 0;
  box-shadow: 4px 4px 0 rgba(0,0,0,0.65);
}

/* ---- header (no top navbar; category selector + tabs + price only) ---- */
#oh-header { position: absolute; top: 0; left: 0; right: 0; padding: 26px 28px 12px; }
#oh-cats { display: flex; gap: 8px; margin-bottom: 16px; }
.oh-cat {
  pointer-events: auto; cursor: pointer;
  background: #0c0c0c; border: 2px solid #262626; border-radius: 0;
  font-family: inherit; font-size: 11px; font-weight: 600; letter-spacing: 0.12em;
  color: ${C.dim}; padding: 5px 12px; transition: color .12s, border-color .12s;
}
.oh-cat:hover { color: #c8c8c8; }
.oh-cat.active { color: ${C.text}; border-color: ${C.text}; box-shadow: 3px 3px 0 rgba(0,0,0,0.65); }
#oh-tabs { display: flex; flex-wrap: wrap; gap: 8px; max-width: 720px; }
.oh-tab {
  pointer-events: auto; cursor: pointer;
  background: #0c0c0c; border: 2px solid #262626; border-radius: 0;
  font-family: inherit; font-size: 13px; line-height: 1.4; color: ${C.dim};
  padding: 6px 14px; transition: color .12s, border-color .12s;
}
.oh-tab:hover { color: #c8c8c8; }
.oh-tab.active { color: ${C.text}; font-weight: 600; border-color: ${C.text}; box-shadow: 3px 3px 0 rgba(0,0,0,0.65); }
#oh-tabline { display: none; }

#oh-priceblock { display: flex; align-items: center; gap: 14px; margin-top: 20px; padding: 2px 0; }
#oh-datetime { margin-top: 6px; font-size: 11px; color: #8a8a8a; letter-spacing: 0.05em; min-height: 14px; }
#oh-price { font-size: 30px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.15; }
#oh-price .oh-hr { font-size: 14px; font-weight: 400; color: ${C.dim}; margin-left: 6px; }
#oh-change {
  font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 0;
  border: 2px solid transparent; font-variant-numeric: tabular-nums; line-height: 1.2;
}
#oh-change.up { color: ${C.chgUpText}; background: ${C.chgUpBg}; border-color: #1d4a2e; }
#oh-change.down { color: ${C.chgDownText}; background: ${C.chgDownBg}; border-color: #4a231d; }
#oh-ranges { display: flex; gap: 6px; margin-left: 6px; }
.oh-pill {
  pointer-events: auto; cursor: pointer; background: #0c0c0c;
  border: 2px solid #262626; border-radius: 0;
  font-family: inherit; font-size: 12px; font-weight: 500; color: ${C.dim};
  padding: 5px 12px; line-height: 1.3; transition: background .12s, color .12s, border-color .12s;
}
.oh-pill:hover { color: #c8c8c8; }
.oh-pill.active { color: #050505; background: ${C.text}; border-color: ${C.text}; box-shadow: 3px 3px 0 rgba(0,0,0,0.65); }
.oh-hidden { display: none !important; }

/* ---- in-run stats ---- */
#oh-stats {
  position: absolute; left: 24px; bottom: 20px; display: flex; gap: 12px;
}
#oh-stats .oh-stat {
  display: flex; flex-direction: column; gap: 3px;
  background: #0c0c0c; border: 2px solid #262626; padding: 8px 14px;
  box-shadow: 4px 4px 0 rgba(0,0,0,0.65);
}
#oh-stats .oh-k { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.dim}; line-height: 1.3; }
#oh-stats .oh-v { font-size: 15px; color: ${C.text}; line-height: 1.25; }
#oh-stats .oh-v.cred { color: ${C.amber}; }
#oh-speed {
  position: absolute; right: 24px; bottom: 20px; text-align: right;
  background: #0c0c0c; border: 2px solid #262626; padding: 8px 14px;
  box-shadow: 4px 4px 0 rgba(0,0,0,0.65);
}
#oh-speed .oh-k { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.dim}; line-height: 1.3; }
#oh-speed .oh-v { font-size: 18px; color: ${C.text}; line-height: 1.25; }
#oh-speed .oh-v span { font-size: 11px; color: ${C.dim}; }

/* ---- nitro meter + boost button ---- */
#oh-nitro { position: absolute; right: 24px; bottom: 78px; width: 132px; }
#oh-nitro .oh-k { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.dim}; text-align: right; margin-bottom: 5px; line-height: 1.3; }
#oh-nitro .oh-track { height: 8px; border-radius: 0; background: #0c0c0c; border: 2px solid #262626; overflow: hidden; }
#oh-nitro .oh-fill { height: 100%; width: 0%; border-radius: 0; background: ${C.amber}; transition: width .08s linear; image-rendering: pixelated; }
#oh-nitro.armed .oh-fill { background: ${C.green}; }
#oh-nitrobtn {
  position: absolute; right: 24px; bottom: 118px; pointer-events: auto; cursor: pointer;
  width: 68px; height: 68px; border-radius: 0; border: 2px solid #2a2a2a;
  background: #0c0c0c; box-shadow: 4px 4px 0 rgba(0,0,0,0.65);
  color: ${C.amber}; font-family: inherit; font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
  display: none; align-items: center; justify-content: center; user-select: none;
  transition: filter .1s, border-color .1s;
}
#oh-nitrobtn.armed { border-color: ${C.amber}; filter: brightness(1.3); }
@media (pointer: coarse) { #oh-nitrobtn { display: flex; } }
#oh-hint {
  position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%);
  font-size: 12px; color: ${C.dim}; letter-spacing: 0.05em; line-height: 1.5;
  padding: 6px 12px; transition: opacity .3s; text-align: center;
}
#oh-hint b { color: ${C.text}; background: #161616; border: 1px solid #2a2a2a; border-radius: 0; padding: 3px 7px; margin: 0 2px; }

/* ---- results ---- */
#oh-results {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  pointer-events: auto; background: rgba(5,5,5,0.72);
}
.oh-rescard {
  width: 340px; background: ${C.panel}; border: 2px solid #2e2e2e; border-radius: 0;
  box-shadow: 6px 6px 0 rgba(0,0,0,0.7); padding: 26px 28px; text-align: center;
}
.oh-restitle { font-size: 16px; font-weight: 700; letter-spacing: 0.16em; line-height: 1.3; margin-bottom: 18px; }
.oh-restitle.crashed { color: ${C.chgDownText}; }
.oh-restitle.finished { color: ${C.chgUpText}; }
.oh-resgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
.oh-rescell { background: #111; border: 2px solid #222; border-radius: 0; padding: 12px 14px; }
.oh-rescell .oh-k { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.dim}; line-height: 1.3; }
.oh-rescell .oh-v { font-size: 18px; font-weight: 600; margin-top: 5px; line-height: 1.25; }
.oh-newbest { font-size: 11px; color: ${C.amber}; letter-spacing: 0.12em; margin-bottom: 14px; min-height: 15px; line-height: 1.3; }
.oh-btnrow { display: flex; gap: 10px; }
.oh-btn {
  flex: 1; font-family: inherit; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; line-height: 1.3;
  padding: 11px 0; border-radius: 0; cursor: pointer; border: 2px solid transparent; transition: filter .12s;
}
.oh-btn:hover { filter: brightness(1.25); }
.oh-btn.primary { background: ${C.text}; color: ${C.chipText}; box-shadow: 3px 3px 0 rgba(0,0,0,0.7); }
.oh-btn.ghost { background: #1c1c1c; color: ${C.dim}; border-color: #2a2a2a; }

/* ---- loading ---- */
#oh-loading {
  position: absolute; left: 50%; top: 55%; transform: translate(-50%,-50%);
  font-size: 13px; letter-spacing: 0.06em; line-height: 1.4; color: ${C.dim};
  padding: 10px 16px; display: flex; align-items: center; gap: 10px;
}
#oh-loading .oh-dot {
  width: 8px; height: 8px; border-radius: 0; background: ${C.text};
  animation: oh-pulse 0.9s steps(2, end) infinite;
}
@keyframes oh-pulse { 0%,100% { opacity: 0.25; } 50% { opacity: 1; } }
`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}

function fmtBest(px: number): string {
  return px > 0 ? `${Math.round(px / 10).toLocaleString('en-US')} m` : '—'
}

const HDR_DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const HDR_TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

export function createHud(
  root: HTMLElement,
  categories: Category[],
  onSelect: (track: Track, range: GpuRange) => void,
  onNitro?: (active: boolean) => void,
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

  let curTrack: Track | null = null
  let curCat: Category = categories[0]

  // ---- header ----
  const header = el('div', '')
  header.id = 'oh-header'
  header.innerHTML = `
    <div id="oh-cats"></div>
    <div id="oh-tabs"></div>
    <div id="oh-tabline"></div>
    <div id="oh-priceblock">
      <div id="oh-price" class="oh-mono">$0.00<span class="oh-hr">/hr</span></div>
      <div id="oh-change" class="up oh-mono">+0.00%</div>
      <div id="oh-ranges"></div>
    </div>
    <div id="oh-datetime" class="oh-mono"></div>`
  hud.appendChild(header)

  const catsEl = header.querySelector<HTMLElement>('#oh-cats')!
  const tabsEl = header.querySelector<HTMLElement>('#oh-tabs')!
  const priceEl = header.querySelector<HTMLElement>('#oh-price')!
  const changeEl = header.querySelector<HTMLElement>('#oh-change')!
  const rangesEl = header.querySelector<HTMLElement>('#oh-ranges')!
  const datetimeEl = header.querySelector<HTMLElement>('#oh-datetime')!

  // Category selector (COMPUTE / MEMORY / TOKENS). Picking one jumps to that
  // category's first track at its default range.
  const catBtns = new Map<string, HTMLButtonElement>()
  for (const cat of categories) {
    const b = el('button', 'oh-cat')
    b.type = 'button'
    b.textContent = cat.label
    b.addEventListener('click', () => {
      if (cat.id === curCat.id) return
      onSelect(cat.tracks[0], defaultRange(cat.id))
    })
    catsEl.appendChild(b)
    catBtns.set(cat.id, b)
  }

  // Track tabs + range pills are rebuilt whenever the category changes.
  const tabBtns = new Map<string, HTMLButtonElement>()
  const pillBtns = new Map<GpuRange, HTMLButtonElement>()
  let activeRange: GpuRange = defaultRange(curCat.id)

  function renderCategory(cat: Category): void {
    tabsEl.replaceChildren()
    tabBtns.clear()
    for (const track of cat.tracks) {
      const b = el('button', 'oh-tab')
      b.type = 'button'
      b.textContent = track.tab
      b.addEventListener('click', () => {
        const range = cat.ranges.includes(activeRange) ? activeRange : defaultRange(cat.id)
        onSelect(track, range)
      })
      tabsEl.appendChild(b)
      tabBtns.set(track.id, b)
    }

    rangesEl.replaceChildren()
    pillBtns.clear()
    // Single-range categories (memory/tokens) hide the picker entirely.
    rangesEl.classList.toggle('oh-hidden', cat.ranges.length <= 1)
    for (const r of cat.ranges) {
      const b = el('button', 'oh-pill')
      b.type = 'button'
      b.textContent = RANGE_LABELS[r]
      b.addEventListener('click', () => {
        if (curTrack) onSelect(curTrack, r)
      })
      rangesEl.appendChild(b)
      pillBtns.set(r, b)
    }
  }
  renderCategory(curCat)

  function setActive(track: Track, range: GpuRange): void {
    const cat = categoryOf(track.category)
    if (cat.id !== curCat.id) {
      curCat = cat
      renderCategory(cat)
    }
    curTrack = track
    activeRange = range
    for (const [id, b] of catBtns) b.classList.toggle('active', id === cat.id)
    for (const [id, b] of tabBtns) b.classList.toggle('active', id === track.id)
    for (const [id, b] of pillBtns) b.classList.toggle('active', id === range)
  }

  function setPrice(price: number): void {
    const unit = curCat.unit
    const decimals = price < 10 ? 3 : 2
    priceEl.innerHTML = `$${price.toFixed(decimals)}<span class="oh-hr">${unit}</span>`
  }

  function setHeader(price: number, changePct: number): void {
    setPrice(price)
    datetimeEl.textContent = ''
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
  hint.innerHTML = 'Press <b>→</b> to ride · <b>Shift</b> nitro'

  // Nitro meter (amber fill) + a touch boost button for coarse pointers.
  const nitro = el('div', '')
  nitro.id = 'oh-nitro'
  nitro.innerHTML = `<div class="oh-k">Nitro</div><div class="oh-track"><div class="oh-fill"></div></div>`
  const nitroFill = nitro.querySelector<HTMLElement>('.oh-fill')!

  const nitroBtn = el('button', '')
  nitroBtn.id = 'oh-nitrobtn'
  nitroBtn.type = 'button'
  nitroBtn.textContent = 'NITRO'
  const pressNitro = (on: boolean) => (e: Event) => { e.preventDefault(); onNitro?.(on) }
  nitroBtn.addEventListener('pointerdown', pressNitro(true))
  nitroBtn.addEventListener('pointerup', pressNitro(false))
  nitroBtn.addEventListener('pointercancel', pressNitro(false))
  nitroBtn.addEventListener('pointerleave', pressNitro(false))

  hud.appendChild(stats)
  hud.appendChild(speed)
  hud.appendChild(nitro)
  hud.appendChild(nitroBtn)
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
  let lastNitro = -1, lastArmed = false
  let lastLivePrice = -1, lastLiveT = -1

  function update(state: GameState): void {
    if (!state.terrain || !state.bike) return
    // Hide the ride hint once the run has begun.
    if (state.started && !hintHidden) { hintHidden = true; hint.style.opacity = '0' }
    if (!state.started && hintHidden) { hintHidden = false; hint.style.opacity = '1' }

    // Live ticker: header shows the price/date under the bike as you ride.
    const lp = Math.round(state.livePrice * 1000)
    if (lp !== lastLivePrice && state.livePrice > 0) {
      lastLivePrice = lp
      setPrice(state.livePrice)
    }
    if (state.liveTimeMs !== lastLiveT) {
      lastLiveT = state.liveTimeMs
      datetimeEl.textContent = state.liveTimeMs
        ? `${HDR_DATE_FMT.format(state.liveTimeMs)} · ${HDR_TIME_FMT.format(state.liveTimeMs)}`
        : ''
    }

    const dist = Math.round(state.distance / 10)
    if (dist !== lastDist) { lastDist = dist; sDist.textContent = `${dist} m` }
    if (state.credits !== lastCred) { lastCred = state.credits; sCred.textContent = String(state.credits) }
    const best = state.track ? (state.bestDistance[state.track.id] ?? 0) : 0
    if (best !== lastBest) { lastBest = best; sBest.textContent = fmtBest(best) }
    const spd = Math.round(state.bike.speed * 0.36)
    if (spd !== lastSpeed) { lastSpeed = spd; sSpeedText.nodeValue = `${spd} ` }

    // Nitro meter fill; "armed" glow while boosting.
    const np = Math.round(state.nitro * 100)
    if (np !== lastNitro) { lastNitro = np; nitroFill.style.width = `${np}%` }
    if (state.nitroActive !== lastArmed) {
      lastArmed = state.nitroActive
      nitro.classList.toggle('armed', state.nitroActive)
      nitroBtn.classList.toggle('armed', state.nitroActive)
    }
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
