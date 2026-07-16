# Ornn Rider — build spec

2D hill-climb-racing-style game: ride a bike over terrain generated from real GPU price charts (Ornn Data API). Vite + vanilla TypeScript + matter-js + Canvas 2D. No frameworks, no extra deps.

Read `src/types.ts` first — it is the contract. Import shared types/palette from `./types`.

## Aesthetic
Ornn product theme: near-black background (#070907), thin grid lines, market green #34d97b for bull/UI accents, red #f05e51 for bear, amber #f5a524 sparingly (forge/heat). Monospace-ish HUD (font stack: 'SF Mono', ui-monospace, Menlo, monospace). Glow effects via ctx.shadowBlur used sparingly (perf: only on small elements, never on terrain fill).

## Modules & owners

### src/data.ts
- `export const TRACKS: Track[]` — 6 tracks:
  - h100: `https://api.ornnai.com/api/h100-history` (full ~2yr history, "The Marathon")
  - a100, b200, h200, rtx5090, rtxpro6000: `https://api.ornnai.com/api/gpu/<ENCODED NAME>/index-history` (last ~90 days). API names: 'A100 SXM4', 'B200', 'H200', 'RTX 5090', 'RTX PRO 6000 WS'. encodeURIComponent the name.
- `export async function fetchSeries(track: Track): Promise<SeriesPoint[]>` — fetch, parse `{data: [{timestamp, index_value}]}`, sort oldest-first, map to SeriesPoint. Cache in localStorage keyed by track.id + date (today), TTL 1 day. On fetch failure, fall back to stale cache; if none, throw.
- All endpoints public, NO auth header.

### src/terrain.ts
- `export function buildTerrain(series: SeriesPoint[]): Terrain`
- Mapping: each day = DX px horizontally. DX = 260 for series ≤ 120 points, 130 for longer (H100). Normalize values: y = BASE - norm(v) * AMPLITUDE where AMPLITUDE scales with series volatility, clamp segment slope to ≤ ~38° so it's rideable. Price up = uphill.
- Smooth with Catmull-Rom, subdivide each day into 10 sub-points.
- Add gentle high-frequency noise (±6px, deterministic from value hash) so flats aren't dead straight.
- Lead-in: 900px of flat/gentle ramp before data starts. Lead-out: 600px flat then a finish flag position (= endX).
- markers: one per raw day at the surface, with changePct.
- groundY/slopeAt: binary search + lerp.

### src/bike.ts
- `export function createBike(engine: Engine, x: number, y: number): Bike`
- matter-js composite: chassis (rectangle ~90x22, density tuned), two wheel circles (r=20, high friction 1.4, restitution 0.15), stiff constraints as suspension (2 constraints per wheel, slight softness stiffness ~0.35 + damping), rider head circle above chassis (crash sensor via collision events on head↔terrain).
- throttle(1): apply angular velocity to BACK wheel toward max (motor torque feel, cap wheel angular speed ~1.05 rad/step at 60fps equivalent); throttle(-1) brakes both wheels / reverse slowly.
- lean(dir): when airborne apply small torque to chassis for flip control; also slight weight-shift effect grounded.
- grounded: raycast/collision check wheels vs terrain body.
- crashed: set true when head contacts terrain (use collisionStart with labels).
- Track flips: integrate chassis rotation while airborne, count full 2π.
- Terrain physics body: created in game.ts from Terrain.points as static edge chain (Bodies.fromVertices is flaky — use many thin static rectangles per segment or Body from vertices pairs; simplest robust: per-segment trapezoid via Bodies.rectangle rotated, friction 1).
  ACTUALLY: bike.ts owns `export function createTerrainBodies(engine: Engine, terrain: Terrain, startX: number): TerrainCollider` (returns `{ update(bikeX) }`, a sliding window of static bodies kept in the world around the bike) too, so all matter code lives here.
- Label conventions: 'terrain', 'chassis', 'wheel', 'head'.

### src/effects.ts
- `export function createEffects(): Effects` — pooled particle array (cap 600, reuse), zero allocation in update loop where possible.
- dust: grey-green puffs at wheel contact scaled by speed; boost: green streaks behind bike when trend > 0.3 and speed high; embers: small red/amber sparks drifting when trend < -0.3; crash: burst of 40 mixed sparks + shake; pickup: small green ring pop.
- shake: exponential decay, offsets camera.

### src/render.ts
- `export function render(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number): void`
- Layers back→front: (1) vertical gradient sky bg0→bg1 with subtle horizontal grid lines (chart paper feel) + faint price-axis labels on left ($/hr values matching terrain heights); (2) two parallax layers of datacenter/server-rack silhouettes (simple dark rounded rects with tiny green LED dots, drawn procedurally, cached to offscreen canvas); (3) terrain: filled shape down to bottom with subtle gradient (green-tinted when local slope up, red-tinted down — precompute per-segment color), crisp 2px top line in C.green; (4) day markers: thin vertical ticks + tiny candlestick glyph, green/red by changePct, coin (credit) floating above uncollected markers; (5) finish flag; (6) bike: procedural vector bike (wheels with spokes that rotate, swingarm, body, rider with helmet — draw from matter body positions/angles), OR sprites from public/assets if present (check via Image onload flag); (7) particles; (8) speed lines at high speed near screen edges.
- Camera: state.camera, look-ahead in movement direction, zoom out slightly with speed (1.0→0.82), smooth lerp. Apply effects.shake.
- Perf: never allocate in render loop; parallax cached offscreen; use setTransform once per layer.

### src/hud.ts (DOM overlay, not canvas)
- `export function createHud(root: HTMLElement)` returning `{ update(state: GameState): void, showMenu(tracks: Track[], best: Record<string,number>, onPick: (t: Track)=>void): void, hideMenu(): void, showResults(state: GameState, onRetry: ()=>void, onMenu: ()=>void): void, hideResults(): void, setLoading(msg: string|null): void }`
- HUD during play: top-left live "ticker" (track name, current price at bike x, day date, changePct chip green/red), top-right distance + credits + best, bottom-right speed. Styled like Ornn dashboard cards: dark panel, 1px border #1e241e, radius 10px, monospace numerals.
- Menu: title "ORNN RIDER", subtitle "ride the compute market", track cards (name, blurb, best distance, tiny sparkline canvas of the series drawn after fetch — optional, skip if not cached), keyboard hints. Crashed/results screen: distance, credits, flips, air time, retry (R) / menu (M).
- All styles injected via one <style> tag from hud.ts. No CSS framework.

### src/audio.ts
- `export function createAudio()` → `{ setEngine(rpm: number, on: boolean): void, thud(mag: number): void, ping(): void, crash(): void, boost(): void, muteToggle(): boolean }`
- Pure WebAudio synthesis, no asset files: engine = sawtooth osc + lowpass, pitch/gain by rpm; thud = filtered noise burst; ping = short sine blip; crash = noise burst; boost = rising filtered saw sweep. Create AudioContext lazily on first user gesture. Master gain 0.25.

### src/game.ts + src/main.ts
- game.ts: `export function startGame(canvas: HTMLCanvasElement, root: HTMLElement): void`
- Owns GameState, matter Engine (gravity y=1.1), fixed timestep 1000/60 accumulator (cap 4 steps), rAF loop, DPR-aware canvas resize (cap DPR at 2 for perf).
- Input: ArrowRight/D or W = throttle, ArrowLeft/S = brake, A/D or Left/Right double-duty lean in air (Up/Down = lean back/forward too), R restart, M menu/mute handling (M = menu on results, otherwise mute), Space = throttle alt. Touch: left half brake, right half throttle.
- Flow: menu → pick track → loading (fetchSeries+buildTerrain+createBike) → playing. Crash → freeze bike control, show results after 900ms. Reaching endX → finished results with confetti-ish green particles.
- Per-frame: update bike, effects; compute trend = smoothed changePct around bike x (drives boost/embers + slight tailwind force when |trend| high — bull market literally pushes you); collect credits when bike within 40px of uncollected marker (credits += 1, ping, pickup fx); flips counting → +bonus credits on landing; camera follow; audio engine rpm; landing impact → thud + dust + shake scaled by impact velocity.
- distance = max(bike.x - startX). Save best to localStorage on crash/finish.
- main.ts: bootstrap canvas + root, call startGame. index.html: fullscreen canvas + #ui root, black bg, no margin, viewport meta.

## Rules for every agent
- TypeScript strict, must compile with `npx tsc --noEmit` cleanly.
- No new dependencies.
- 60fps target: no per-frame allocations in hot paths, cache gradients where possible.
- Keep it lean. No classes where a closure works. No premature abstraction.
- Import only from './types' and your own module's declared collaborators as listed above.
