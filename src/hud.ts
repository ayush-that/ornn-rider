// DOM overlay HUD + menus, styled like an Ornn dashboard. All CSS injected here.
import type { GameState, Track, SeriesPoint } from './types'
import { C } from './types'

const CSS = `
#ornn-hud, #ornn-hud * { box-sizing: border-box; margin: 0; padding: 0; }
#ornn-hud {
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font-family: 'SF Mono', ui-monospace, Menlo, monospace;
  color: ${C.text};
  -webkit-font-smoothing: antialiased;
  user-select: none;
}
.oh-card {
  background: ${C.panel}e6;
  border: 1px solid ${C.line};
  border-radius: 10px;
  padding: 10px 14px;
  backdrop-filter: blur(4px);
}
.oh-label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.dim}; }
.oh-num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
.oh-chip {
  display: inline-block; font-size: 11px; padding: 2px 7px; border-radius: 6px;
  font-variant-numeric: tabular-nums; letter-spacing: 0.02em;
}
.oh-chip.up { color: ${C.green}; background: rgba(52,217,123,0.12); border: 1px solid rgba(52,217,123,0.3); }
.oh-chip.down { color: ${C.red}; background: rgba(240,94,81,0.12); border: 1px solid rgba(240,94,81,0.3); }

/* live HUD */
#oh-ticker { position: absolute; top: 14px; left: 14px; min-width: 210px; }
#oh-ticker .oh-track { font-size: 12px; color: ${C.green}; letter-spacing: 0.08em; margin-bottom: 6px; }
#oh-ticker .oh-price { font-size: 24px; font-weight: 600; line-height: 1.1; }
#oh-ticker .oh-row2 { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
#oh-ticker .oh-date { font-size: 11px; color: ${C.dim}; }
#oh-stats { position: absolute; top: 14px; right: 14px; display: flex; gap: 10px; text-align: right; }
#oh-stats .oh-stat { min-width: 84px; }
#oh-stats .oh-val { font-size: 18px; font-weight: 600; margin-top: 3px; }
#oh-stats .oh-val.credits { color: ${C.amber}; }
#oh-speed { position: absolute; right: 14px; bottom: 14px; text-align: right; }
#oh-speed .oh-val { font-size: 22px; font-weight: 600; margin-top: 2px; }
#oh-speed .oh-val span { font-size: 11px; color: ${C.dim}; font-weight: 400; }

/* overlays */
.oh-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; pointer-events: auto;
  background: radial-gradient(ellipse at 50% 40%, rgba(12,15,12,0.88), rgba(7,9,7,0.96));
}
.oh-title {
  font-size: 42px; font-weight: 700; letter-spacing: 0.22em; color: ${C.text};
  text-shadow: 0 0 24px ${C.glow};
}
.oh-title em { font-style: normal; color: ${C.green}; }
.oh-sub { font-size: 12px; letter-spacing: 0.3em; text-transform: uppercase; color: ${C.dim}; margin: 10px 0 34px; }
.oh-tracks {
  display: grid; grid-template-columns: repeat(3, 250px); gap: 14px; max-width: 810px;
}
@media (max-width: 840px) { .oh-tracks { grid-template-columns: repeat(2, 250px); } }
@media (max-width: 560px) { .oh-tracks { grid-template-columns: 250px; } }
.oh-tcard {
  background: ${C.panel}; border: 1px solid ${C.line}; border-radius: 10px;
  padding: 14px; text-align: left; cursor: pointer; color: ${C.text};
  font-family: inherit; transition: border-color .12s, transform .12s, box-shadow .12s;
}
.oh-tcard:hover, .oh-tcard:focus-visible {
  border-color: ${C.green}; transform: translateY(-2px);
  box-shadow: 0 6px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(52,217,123,0.2);
  outline: none;
}
.oh-tcard .oh-tname { font-size: 14px; font-weight: 600; letter-spacing: 0.04em; }
.oh-tcard .oh-tblurb { font-size: 11px; color: ${C.dim}; line-height: 1.5; margin: 6px 0 10px; min-height: 33px; }
.oh-tcard canvas { display: block; width: 100%; height: 44px; margin-bottom: 10px; }
.oh-tcard .oh-tbest { display: flex; justify-content: space-between; align-items: center; }
.oh-tcard .oh-tbest .oh-num { font-size: 13px; color: ${C.green}; }
.oh-hints { margin-top: 30px; font-size: 11px; color: ${C.dim}; letter-spacing: 0.06em; }
.oh-hints b { color: ${C.text}; font-weight: 600; background: ${C.panel}; border: 1px solid ${C.line}; border-radius: 5px; padding: 2px 6px; margin: 0 2px; }

/* results */
.oh-rescard { width: 340px; padding: 26px 28px; text-align: center; }
.oh-restitle { font-size: 22px; font-weight: 700; letter-spacing: 0.18em; margin-bottom: 18px; }
.oh-restitle.crashed { color: ${C.red}; text-shadow: 0 0 18px rgba(240,94,81,0.4); }
.oh-restitle.finished { color: ${C.green}; text-shadow: 0 0 18px ${C.glow}; }
.oh-resgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.oh-rescell { background: ${C.bg1}; border: 1px solid ${C.line}; border-radius: 8px; padding: 10px; }
.oh-rescell .oh-val { font-size: 18px; font-weight: 600; margin-top: 4px; }
.oh-newbest { font-size: 11px; color: ${C.amber}; letter-spacing: 0.12em; margin-bottom: 12px; min-height: 14px; }
.oh-btnrow { display: flex; gap: 10px; margin-top: 6px; }
.oh-btn {
  flex: 1; font-family: inherit; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 10px 0; border-radius: 8px; cursor: pointer; transition: filter .12s;
}
.oh-btn:hover { filter: brightness(1.2); }
.oh-btn.primary { background: rgba(52,217,123,0.14); border: 1px solid ${C.green}; color: ${C.green}; }
.oh-btn.ghost { background: transparent; border: 1px solid ${C.line}; color: ${C.dim}; }

/* loading */
#oh-loading { flex-direction: row; gap: 12px; font-size: 13px; letter-spacing: 0.1em; color: ${C.dim}; }
#oh-loading .oh-dot {
  width: 8px; height: 8px; border-radius: 50%; background: ${C.green};
  box-shadow: 0 0 10px ${C.glow}; animation: oh-pulse 0.9s ease-in-out infinite;
}
@keyframes oh-pulse { 0%,100% { opacity: 0.25; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.1); } }
.oh-hidden { display: none !important; }
`

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}

// Best-effort read of data.ts's localStorage series cache for menu sparklines.
function cachedSeries(trackId: string): SeriesPoint[] | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.includes(trackId)) continue
      const raw = localStorage.getItem(key)
      if (!raw || raw[0] !== '{' && raw[0] !== '[') continue
      const parsed: unknown = JSON.parse(raw)
      const arr: unknown = Array.isArray(parsed) ? parsed
        : parsed && typeof parsed === 'object'
          ? ((parsed as Record<string, unknown>)['points'] ?? (parsed as Record<string, unknown>)['series'] ?? (parsed as Record<string, unknown>)['data'])
          : null
      if (!Array.isArray(arr) || arr.length < 2) continue
      const first = arr[0] as Record<string, unknown>
      if (typeof first['v'] === 'number') return arr as SeriesPoint[]
      if (typeof first['index_value'] === 'number') {
        return (arr as Array<{ timestamp: string | number; index_value: number }>)
          .map(p => ({ t: new Date(p.timestamp).getTime(), v: p.index_value }))
      }
    }
  } catch { /* corrupt cache — no sparkline */ }
  return null
}

function drawSparkline(canvas: HTMLCanvasElement, series: SeriesPoint[]): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = 222, h = 44
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  let min = Infinity, max = -Infinity
  for (const p of series) { if (p.v < min) min = p.v; if (p.v > max) max = p.v }
  const span = max - min || 1
  const up = series[series.length - 1]!.v >= series[0]!.v
  const color = up ? C.green : C.red
  const px = (i: number) => 2 + (i / (series.length - 1)) * (w - 4)
  const py = (v: number) => h - 5 - ((v - min) / span) * (h - 10)
  ctx.beginPath()
  ctx.moveTo(px(0), py(series[0]!.v))
  for (let i = 1; i < series.length; i++) ctx.lineTo(px(i), py(series[i]!.v))
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.lineTo(px(series.length - 1), h)
  ctx.lineTo(px(0), h)
  ctx.closePath()
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, up ? 'rgba(52,217,123,0.22)' : 'rgba(240,94,81,0.22)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fill()
}

function fmtBest(px: number): string {
  return px > 0 ? `${Math.round(px / 10).toLocaleString('en-US')} m` : '—'
}

export function createHud(root: HTMLElement) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const hud = el('div', '')
  hud.id = 'ornn-hud'
  root.appendChild(hud)

  // ---- live HUD ----
  const ticker = el('div', 'oh-card')
  ticker.id = 'oh-ticker'
  ticker.innerHTML = `
    <div class="oh-track"></div>
    <div class="oh-price oh-num">$0.00<span style="font-size:12px;color:${C.dim}">/hr</span></div>
    <div class="oh-row2"><span class="oh-chip up oh-num">+0.00%</span><span class="oh-date"></span></div>`
  const tTrack = ticker.querySelector<HTMLElement>('.oh-track')!
  const tPrice = ticker.querySelector<HTMLElement>('.oh-price')!
  const tChip = ticker.querySelector<HTMLElement>('.oh-chip')!
  const tDate = ticker.querySelector<HTMLElement>('.oh-date')!

  const stats = el('div', '')
  stats.id = 'oh-stats'
  stats.innerHTML = `
    <div class="oh-card oh-stat"><div class="oh-label">Distance</div><div class="oh-val oh-num" data-k="dist">0 m</div></div>
    <div class="oh-card oh-stat"><div class="oh-label">Credits</div><div class="oh-val credits oh-num" data-k="cred">0</div></div>
    <div class="oh-card oh-stat"><div class="oh-label">Best</div><div class="oh-val oh-num" data-k="best">—</div></div>`
  const sDist = stats.querySelector<HTMLElement>('[data-k="dist"]')!
  const sCred = stats.querySelector<HTMLElement>('[data-k="cred"]')!
  const sBest = stats.querySelector<HTMLElement>('[data-k="best"]')!

  const speedCard = el('div', 'oh-card')
  speedCard.id = 'oh-speed'
  speedCard.innerHTML = `<div class="oh-label">Speed</div><div class="oh-val oh-num">0 <span>km/h</span></div>`
  const sSpeed = speedCard.querySelector<HTMLElement>('.oh-val')!
  // dedicated Text node so speed updates mutate character data only
  const sSpeedText = sSpeed.firstChild as Text

  hud.appendChild(ticker)
  hud.appendChild(stats)
  hud.appendChild(speedCard)

  // ---- overlays ----
  const menu = el('div', 'oh-overlay oh-hidden')
  const results = el('div', 'oh-overlay oh-hidden')
  const loading = el('div', 'oh-overlay oh-hidden')
  loading.id = 'oh-loading'
  loading.innerHTML = `<div class="oh-dot"></div><span></span>`
  const loadingMsg = loading.querySelector<HTMLElement>('span')!
  hud.appendChild(menu)
  hud.appendChild(results)
  hud.appendChild(loading)

  // dirty-check caches so update() never touches the DOM redundantly
  let lastPrice = -1, lastPct = NaN, lastDate = '', lastDist = -1, lastCred = -1,
    lastBest = -1, lastSpeed = -1, lastTrackId = '', lastMarkerIdx = -1, hudVisible = true

  function setHudVisible(v: boolean): void {
    if (v === hudVisible) return
    hudVisible = v
    const d = v ? '' : 'none'
    ticker.style.display = d
    stats.style.display = d
    speedCard.style.display = d
  }

  function update(state: GameState): void {
    const playing = state.phase === 'playing' || state.phase === 'crashed' || state.phase === 'finished'
    setHudVisible(playing && !!state.terrain)
    if (!hudVisible || !state.terrain || !state.bike) return

    if (state.track && state.track.id !== lastTrackId) {
      lastTrackId = state.track.id
      tTrack.textContent = state.track.label
      lastMarkerIdx = -1
      lastBest = -1
    }

    // nearest marker at/behind bike x (markers are x-ascending; walk from cached index)
    const markers = state.terrain.markers
    const bx = state.bike.chassis.position.x
    let i = lastMarkerIdx < 0 ? 0 : lastMarkerIdx
    while (i + 1 < markers.length && markers[i + 1]!.x <= bx) i++
    while (i > 0 && markers[i]!.x > bx) i--
    lastMarkerIdx = i
    const m = markers[i]
    if (m) {
      if (m.v !== lastPrice) {
        lastPrice = m.v
        tPrice.innerHTML = `$${m.v.toFixed(2)}<span style="font-size:12px;color:${C.dim}">/hr</span>`
      }
      if (m.changePct !== lastPct) {
        lastPct = m.changePct
        tChip.textContent = `${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(2)}%`
        tChip.className = m.changePct >= 0 ? 'oh-chip up oh-num' : 'oh-chip down oh-num'
      }
      if (Number.isFinite(m.t)) {
        const ds = DATE_FMT.format(m.t)
        if (ds !== lastDate) { lastDate = ds; tDate.textContent = ds }
      }
    }

    const dist = Math.round(state.distance / 10)
    if (dist !== lastDist) { lastDist = dist; sDist.textContent = `${dist} m` }
    if (state.credits !== lastCred) { lastCred = state.credits; sCred.textContent = String(state.credits) }
    const best = state.track ? (state.bestDistance[state.track.id] ?? 0) : 0
    if (best !== lastBest) { lastBest = best; sBest.textContent = fmtBest(best) }
    const spd = Math.round(state.bike.speed * 0.36) // px/s ≈ dm/s → km/h-ish
    if (spd !== lastSpeed) {
      lastSpeed = spd
      sSpeedText.nodeValue = `${spd} `
    }
  }

  function showMenu(tracks: Track[], best: Record<string, number>, onPick: (t: Track) => void): void {
    menu.innerHTML = ''
    menu.appendChild(el('div', 'oh-title', 'ORNN <em>RIDER</em>'))
    menu.appendChild(el('div', 'oh-sub', 'ride the compute market'))
    const grid = el('div', 'oh-tracks')
    for (const track of tracks) {
      const card = el('button', 'oh-tcard')
      card.type = 'button'
      card.innerHTML = `
        <div class="oh-tname">${track.label}</div>
        <div class="oh-tblurb">${track.blurb}</div>
        <div class="oh-tbest"><span class="oh-label">Best</span><span class="oh-num">${fmtBest(best[track.id] ?? 0)}</span></div>`
      const series = cachedSeries(track.id)
      if (series) {
        const cv = document.createElement('canvas')
        card.insertBefore(cv, card.querySelector('.oh-tbest'))
        drawSparkline(cv, series)
      }
      card.addEventListener('click', () => onPick(track))
      grid.appendChild(card)
    }
    menu.appendChild(grid)
    menu.appendChild(el('div', 'oh-hints',
      '<b>→</b>/<b>D</b> throttle &nbsp; <b>←</b>/<b>S</b> brake &nbsp; <b>A</b>/<b>D</b> lean in air &nbsp; <b>R</b> restart &nbsp; <b>M</b> mute'))
    menu.classList.remove('oh-hidden')
  }

  function hideMenu(): void {
    menu.classList.add('oh-hidden')
  }

  function showResults(state: GameState, onRetry: () => void, onMenu: () => void): void {
    const finished = state.phase === 'finished'
    const distM = Math.round(state.distance / 10)
    const prevBest = state.track ? (state.bestDistance[state.track.id] ?? 0) : 0
    const isBest = state.distance >= prevBest && state.distance > 0
    results.innerHTML = ''
    const card = el('div', 'oh-card oh-rescard')
    card.innerHTML = `
      <div class="oh-restitle ${finished ? 'finished' : 'crashed'}">${finished ? 'FINISH' : 'CRASHED'}</div>
      <div class="oh-newbest">${isBest ? '★ NEW BEST' : ''}</div>
      <div class="oh-resgrid">
        <div class="oh-rescell"><div class="oh-label">Distance</div><div class="oh-val oh-num" style="color:${C.green}">${distM.toLocaleString('en-US')} m</div></div>
        <div class="oh-rescell"><div class="oh-label">Credits</div><div class="oh-val oh-num" style="color:${C.amber}">${state.credits}</div></div>
        <div class="oh-rescell"><div class="oh-label">Flips</div><div class="oh-val oh-num">${state.flips}</div></div>
        <div class="oh-rescell"><div class="oh-label">Air time</div><div class="oh-val oh-num">${(state.airTimeMs / 1000).toFixed(1)}s</div></div>
      </div>
      <div class="oh-btnrow">
        <button type="button" class="oh-btn primary">Retry (R)</button>
        <button type="button" class="oh-btn ghost">Menu (M)</button>
      </div>`
    const btns = card.querySelectorAll<HTMLButtonElement>('.oh-btn')
    btns[0]!.addEventListener('click', onRetry)
    btns[1]!.addEventListener('click', onMenu)
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

  return { update, showMenu, hideMenu, showResults, hideResults, setLoading }
}
