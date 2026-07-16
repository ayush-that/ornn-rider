# NDS-style touch controls + mobile responsiveness

## Problem

The game (`src/routes/index.tsx` + `src/lib/game/*`) is a side-scrolling bike
physics game rendered on a full-viewport canvas with a DOM HUD overlay
(`hud.ts`). Touch support today is minimal:

- Tapping the left/right half of the canvas brakes/throttles
  (`game.ts:262-270`).
- A single "NITRO" button is shown bottom-right on coarse pointers
  (`hud.ts:94-103`, wired in `game.ts:96`).
- There is no touch equivalent for lean-forward/nose-dive (`KeyD`/`ArrowRight`,
  `scene.ts:862`).
- No orientation guidance: a portrait phone just gets a squeezed viewport.
- HUD elements use fixed pixel offsets (`left: 24px`, `bottom: 78px`, etc.)
  that were not designed against small/short viewports.

## Goal

Add Nintendo DS-style on-screen controls (D-pad + single A button) for touch
devices, and make the HUD/layout responsive on mobile — including guiding
players to landscape orientation, which this game requires.

## Design

### 1. Touch input state

Extend the shared touch state from `{throttle, brake, nitro}` to
`{throttle, brake, leanFwd, nitro}`:

- `game.ts`: `touch` object gains `leanFwd: false`; `clearInput`/`clearTouch`
  reset it alongside the others.
- `scene.ts:149`: `GameCtx.touch` type gains `leanFwd: boolean`.
- `scene.ts:862`: `leanFwd` calc gains `|| this.ctx.touch.leanFwd`.

This closes an existing gap — nose-dive currently has no touch control at all.

### 2. Remove tap-zone input, add D-pad + A button

- Remove the canvas `pointerdown`/`pointerup`/`pointercancel`/`pointerleave`
  tap-zone listeners in `game.ts` (lines 262-270). Keyboard input (W/A/D/Shift/R/M)
  is unchanged.
- In `hud.ts`, add two new control clusters, shown only under
  `@media (pointer: coarse)` (same gate the current nitro button uses today —
  desktop/mouse users see none of this):
  - **D-pad**, bottom-left: a 4-direction cross (Up/Left/Right wired, Down
    inert — no existing action needs it).
    - Up → `touch.throttle = true` (gas)
    - Left → `touch.brake = true` (lean back / wheelie)
    - Right → `touch.leanFwd = true` (lean forward / nose dive)
    - Each direction is its own pointer target with `pointerdown` (set true)
      and `pointerup`/`pointercancel`/`pointerleave` (set false), same pattern
      as the existing nitro button handlers.
  - **A button**, bottom-right: single button, same nitro press/release
    handlers currently on `#oh-nitrobtn`. The old dedicated nitro button
    element is removed for coarse pointers — the A button replaces it
    one-for-one. The nitro meter bar (`#oh-nitro`) stays and is repositioned
    to sit above the control row instead of overlapping it.
  - Visual style: reuse the game's existing pixel-panel language (`.oh-panel`:
    square corners, 2px border, hard offset shadow) rather than inventing a
    new visual system — square/graphite D-pad cross and a round/square "A"
    button consistent with the current dark HUD theme, legible in both the
    game's existing dark palette.

### 3. Responsive HUD layout

On coarse-pointer viewports:

- Reduce header (`#oh-header`) padding and font sizes so category tabs / price
  block fit on narrow/short mobile viewports without wrapping awkwardly.
- Relocate bottom stat readouts (`#oh-stats`, `#oh-speed`, `#oh-nitro`) so
  nothing renders under the D-pad/A-button corners — e.g. move them up to sit
  directly above the control row, or compact into the top area under the
  header. Exact offsets are an implementation detail; the constraint is fixed:
  **the D-pad and A button own the bottom-left/bottom-right corners on mobile;
  no other HUD element may overlap them.**
- The bottom-center hint (`#oh-hint`) swaps its copy on coarse pointers to
  describe the touch controls (e.g. "D-PAD gas/lean · A nitro") instead of the
  keyboard hint, using the same `pointer: coarse` media gate. It still
  hides/shows on run start exactly as today.

### 4. Rotate-to-landscape prompt

- A full-screen overlay, shown only when the viewport is both coarse-pointer
  and portrait (`@media (pointer: coarse) and (orientation: portrait)`),
  implemented as a pure-CSS-gated element in the HUD (no JS orientation
  polling needed — CSS media queries re-evaluate automatically on rotation).
- Content: dark background, a simple rotate icon/glyph, and "Rotate your
  device to play" text. It sits above canvas + HUD (`z-index` above `#ornn-hud`)
  and blocks interaction while shown; disappears immediately when the device
  is rotated to landscape. No dismiss control — it's not a modal the user
  can opt out of, since the game is unplayable in portrait.

### 5. Out of scope

- No changes to desktop/mouse/keyboard behavior, physics, or visuals.
- No additional face buttons (B/X/Y) or touch-based restart — a plain A
  button for nitro is sufficient per the chosen design.
- No changes to Phaser scene physics beyond the one-line `leanFwd` read.

## Testing

- Manual verification via browser devtools device toolbar (touch + portrait
  emulation) since this is canvas/DOM interaction code without existing test
  coverage in this area.
- Confirm keyboard play (desktop) is pixel-identical to before — no visual or
  behavioral regression for `pointer: fine` users.
