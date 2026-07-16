# NDS-style Touch Controls + Mobile Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tap-anywhere touch controls with a Nintendo-DS-style D-pad + A button, and make the HUD layout responsive on mobile, including a rotate-to-landscape prompt.

**Architecture:** All touch UI lives in `src/lib/game/hud.ts` (DOM overlay + injected CSS), gated behind the existing `@media (pointer: coarse)` pattern already used for the current nitro button. Input state flows through the `touch` object shared between `game.ts` and `scene.ts` (already how `throttle`/`brake`/`nitro` work today) — we're extending that object with `leanFwd` and rewiring who sets it, not inventing a new mechanism.

**Tech Stack:** Plain DOM + vanilla CSS-in-JS template string (existing pattern in `hud.ts`), Phaser/Matter scene (`scene.ts`), no new dependencies.

## Global Constraints

- Desktop / `pointer: fine` behavior, visuals, and physics must be pixel-identical to before this change — every new control and layout change is gated behind `@media (pointer: coarse)` or the `pointer: coarse` `matchMedia` check, exactly like the existing nitro button gate at `hud.ts:103`.
- No test framework exists in this repo (`package.json` has no test script). Verification is: `pnpm lint` (type-aware) after every task, plus a manual check in Chrome DevTools' device toolbar (touch + portrait/landscape emulation) as described in each task.
- No changes to keyboard controls (W/A/D/Shift/R/M) or Matter physics beyond the one-line `leanFwd` read added in Task 1.
- Reuse the existing pixel-panel visual language (`.oh-panel`: square corners, 2px `#262626` border, hard offset shadow, `${C.text}`/`${C.dim}`/`${C.amber}` colors) — don't invent a new visual system for the D-pad/A button.

---

### Task 1: Touch state plumbing — add `leanFwd`, remove tap-zones

**Files:**

- Modify: `src/lib/game/scene.ts:149` (`GameCtx.touch` type)
- Modify: `src/lib/game/scene.ts:862` (`leanFwd` calculation)
- Modify: `src/lib/game/game.ts:88` (`touch` state object)
- Modify: `src/lib/game/game.ts:258` (`clearInput`)
- Modify: `src/lib/game/game.ts:261-270` (remove canvas tap-zone listeners)

**Interfaces:**

- Produces: `touch: { throttle: boolean; brake: boolean; leanFwd: boolean; nitro: boolean }` — the shape Task 2's D-pad handlers and Task 3's callback wiring must match exactly.

- [ ] **Step 1: Extend the `GameCtx.touch` type in `scene.ts`**

At `scene.ts:149`, change:

```ts
touch: {
  throttle: boolean;
  brake: boolean;
  nitro: boolean;
}
```

to:

```ts
touch: {
  throttle: boolean;
  brake: boolean;
  leanFwd: boolean;
  nitro: boolean;
}
```

- [ ] **Step 2: Wire `leanFwd` into the lean calculation**

At `scene.ts:862`, change:

```ts
const leanFwd = this.down("KeyD") || this.down("ArrowRight");
```

to:

```ts
const leanFwd = this.down("KeyD") || this.down("ArrowRight") || this.ctx.touch.leanFwd;
```

- [ ] **Step 3: Extend the `touch` state object in `game.ts`**

At `game.ts:88`, change:

```ts
const touch = { throttle: false, brake: false, nitro: false };
```

to:

```ts
const touch = { throttle: false, brake: false, leanFwd: false, nitro: false };
```

- [ ] **Step 4: Reset `leanFwd` in `clearInput`**

At `game.ts:258`, change:

```ts
const clearInput = (): void => {
  keys.clear();
  touch.throttle = false;
  touch.brake = false;
  touch.nitro = false;
};
```

to:

```ts
const clearInput = (): void => {
  keys.clear();
  touch.throttle = false;
  touch.brake = false;
  touch.leanFwd = false;
  touch.nitro = false;
};
```

- [ ] **Step 5: Remove the canvas tap-zone listeners**

At `game.ts:261-270`, delete this whole block (it's superseded by the D-pad added in Task 2):

```ts
// --- touch halves on the canvas (left = brake, right = throttle) ---
canvas.addEventListener(
  "pointerdown",
  (e) => {
    if (state.phase !== "playing") return;
    if (e.clientX < window.innerWidth / 2) touch.brake = true;
    else touch.throttle = true;
  },
  listen,
);
const clearTouch = (): void => {
  touch.throttle = false;
  touch.brake = false;
};
canvas.addEventListener("pointerup", clearTouch, listen);
canvas.addEventListener("pointercancel", clearTouch, listen);
canvas.addEventListener("pointerleave", clearTouch, listen);
```

Leave the blank line before `activeStop = () => {` in place.

- [ ] **Step 6: Verify types compile**

Run: `pnpm lint`
Expected: no new type errors (there will still be one expected error — `game.ts`'s call to `createHud` passing a single `onNitro` function where `touch.leanFwd` isn't wired yet. That's fixed in Task 2. If Task 1 is committed standalone, temporarily confirm only pre-existing errors appear by running `pnpm lint` before this step's changes as a baseline comparison.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/game/scene.ts src/lib/game/game.ts
git commit -m "Add touch leanFwd state, remove tap-zone canvas listeners"
```

---

### Task 2: D-pad + A button (touch controls)

**Files:**

- Modify: `src/lib/game/hud.ts` (CSS block, `createHud` signature, markup, `update()`)
- Modify: `src/lib/game/game.ts:92-97` (`createHud` call site)

**Interfaces:**

- Consumes: `touch: { throttle: boolean; brake: boolean; leanFwd: boolean; nitro: boolean }` from Task 1.
- Produces: `createHud(root, categories, onSelect, onTouch)` where
  `onTouch: { throttle: (active: boolean) => void; brake: (active: boolean) => void; leanFwd: (active: boolean) => void; nitro: (active: boolean) => void }`
  — Task 3 and Task 4 read/modify the same `hud.ts` file and must keep this signature.

- [ ] **Step 1: Replace the old nitro-button CSS with D-pad + A-button CSS**

In `hud.ts`, find this block (lines 94-103):

```css
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
```

Replace it with:

```css
/* ---- NDS-style D-pad + A button (coarse pointer only) ---- */
#oh-dpad { position: absolute; left: 20px; bottom: 20px; width: 132px; height: 132px; display: none; }
.oh-dpad-btn {
  position: absolute; pointer-events: auto; cursor: pointer;
  width: 44px; height: 44px; border-radius: 0; border: 2px solid #2a2a2a;
  background: #1a1a1a; box-shadow: 3px 3px 0 rgba(0,0,0,0.65);
  display: flex; align-items: center; justify-content: center;
  color: ${C.dim}; font-size: 16px; font-family: inherit; user-select: none;
  transition: filter .08s, border-color .08s;
}
.oh-dpad-btn.pressed { filter: brightness(1.6); border-color: ${C.text}; color: ${C.text}; }
.oh-dpad-btn:disabled { background: #101010; border-color: #1e1e1e; color: #3a3a3a; cursor: default; }
#oh-dpad-up { left: 44px; top: 0; }
#oh-dpad-left { left: 0; top: 44px; }
#oh-dpad-right { left: 88px; top: 44px; }
#oh-dpad-down { left: 44px; top: 88px; }
#oh-abtn {
  position: absolute; right: 24px; bottom: 20px; display: none; pointer-events: auto; cursor: pointer;
  width: 72px; height: 72px; border-radius: 50%; border: 2px solid #2a2a2a;
  background: #0c0c0c; box-shadow: 4px 4px 0 rgba(0,0,0,0.65);
  color: ${C.amber}; font-family: inherit; font-size: 20px; font-weight: 700;
  align-items: center; justify-content: center; user-select: none;
  transition: filter .1s, border-color .1s;
}
#oh-abtn.armed { border-color: ${C.amber}; filter: brightness(1.3); }
@media (pointer: coarse) { #oh-dpad { display: block; } #oh-abtn { display: flex; } }
```

- [ ] **Step 2: Update the `createHud` signature to take an `onTouch` object**

Find (around `hud.ts:164-169`):

```ts
export function createHud(
  root: HTMLElement,
  categories: Category[],
  onSelect: (track: Track, range: GpuRange) => void,
  onNitro?: (active: boolean) => void,
) {
```

Replace with:

```ts
export function createHud(
  root: HTMLElement,
  categories: Category[],
  onSelect: (track: Track, range: GpuRange) => void,
  onTouch: {
    throttle: (active: boolean) => void
    brake: (active: boolean) => void
    leanFwd: (active: boolean) => void
    nitro: (active: boolean) => void
  },
) {
```

- [ ] **Step 3: Replace the nitro-button markup/wiring with D-pad + A-button markup/wiring**

Find this block (around `hud.ts:301-320`, from the "Nitro meter" comment through the `hud.appendChild` calls):

```ts
// Nitro meter (amber fill) + a touch boost button for coarse pointers.
const nitro = el("div", "");
nitro.id = "oh-nitro";
nitro.innerHTML = `<div class="oh-k">Nitro</div><div class="oh-track"><div class="oh-fill"></div></div>`;
const nitroFill = nitro.querySelector<HTMLElement>(".oh-fill")!;

const nitroBtn = el("button", "");
nitroBtn.id = "oh-nitrobtn";
nitroBtn.type = "button";
nitroBtn.textContent = "NITRO";
const pressNitro = (on: boolean) => (e: Event) => {
  e.preventDefault();
  onNitro?.(on);
};
nitroBtn.addEventListener("pointerdown", pressNitro(true));
nitroBtn.addEventListener("pointerup", pressNitro(false));
nitroBtn.addEventListener("pointercancel", pressNitro(false));
nitroBtn.addEventListener("pointerleave", pressNitro(false));

hud.appendChild(stats);
hud.appendChild(speed);
hud.appendChild(nitro);
hud.appendChild(nitroBtn);
hud.appendChild(hint);
```

Replace with:

```ts
// Nitro meter (amber fill); armed state is mirrored onto the A button below.
const nitro = el("div", "");
nitro.id = "oh-nitro";
nitro.innerHTML = `<div class="oh-k">Nitro</div><div class="oh-track"><div class="oh-fill"></div></div>`;
const nitroFill = nitro.querySelector<HTMLElement>(".oh-fill")!;

// D-pad (touch): Up = gas, Left = wheelie (lean back), Right = nose dive
// (lean forward). Down is decorative — no action uses it.
const dpad = el("div", "");
dpad.id = "oh-dpad";
dpad.innerHTML = `
    <button type="button" id="oh-dpad-up" class="oh-dpad-btn">&#9650;</button>
    <button type="button" id="oh-dpad-left" class="oh-dpad-btn">&#9664;</button>
    <button type="button" id="oh-dpad-right" class="oh-dpad-btn">&#9654;</button>
    <button type="button" id="oh-dpad-down" class="oh-dpad-btn" disabled>&#9660;</button>`;
const dpadUp = dpad.querySelector<HTMLButtonElement>("#oh-dpad-up")!;
const dpadLeft = dpad.querySelector<HTMLButtonElement>("#oh-dpad-left")!;
const dpadRight = dpad.querySelector<HTMLButtonElement>("#oh-dpad-right")!;

function wireDpadBtn(btn: HTMLButtonElement, onPress: (active: boolean) => void): void {
  const set = (active: boolean) => (e: Event) => {
    e.preventDefault();
    btn.classList.toggle("pressed", active);
    onPress(active);
  };
  btn.addEventListener("pointerdown", set(true));
  btn.addEventListener("pointerup", set(false));
  btn.addEventListener("pointercancel", set(false));
  btn.addEventListener("pointerleave", set(false));
}
wireDpadBtn(dpadUp, onTouch.throttle);
wireDpadBtn(dpadLeft, onTouch.brake);
wireDpadBtn(dpadRight, onTouch.leanFwd);

// A button (touch): nitro.
const aBtn = el("button", "");
aBtn.id = "oh-abtn";
aBtn.type = "button";
aBtn.textContent = "A";
const pressA = (on: boolean) => (e: Event) => {
  e.preventDefault();
  onTouch.nitro(on);
};
aBtn.addEventListener("pointerdown", pressA(true));
aBtn.addEventListener("pointerup", pressA(false));
aBtn.addEventListener("pointercancel", pressA(false));
aBtn.addEventListener("pointerleave", pressA(false));

hud.appendChild(stats);
hud.appendChild(speed);
hud.appendChild(nitro);
hud.appendChild(dpad);
hud.appendChild(aBtn);
hud.appendChild(hint);
```

- [ ] **Step 4: Update the nitro-armed toggle in `update()` to target the A button**

Find (around `hud.ts:370-374`):

```ts
if (state.nitroActive !== lastArmed) {
  lastArmed = state.nitroActive;
  nitro.classList.toggle("armed", state.nitroActive);
  nitroBtn.classList.toggle("armed", state.nitroActive);
}
```

Replace with:

```ts
if (state.nitroActive !== lastArmed) {
  lastArmed = state.nitroActive;
  nitro.classList.toggle("armed", state.nitroActive);
  aBtn.classList.toggle("armed", state.nitroActive);
}
```

- [ ] **Step 5: Update the `createHud` call site in `game.ts`**

At `game.ts:92-97`, change:

```ts
const hud = createHud(
  root,
  CATEGORIES,
  (t: Track, r: GpuRange) => void loadTrack(t, r),
  (active: boolean) => {
    touch.nitro = active;
  },
);
```

to:

```ts
const hud = createHud(root, CATEGORIES, (t: Track, r: GpuRange) => void loadTrack(t, r), {
  throttle: (active) => {
    touch.throttle = active;
  },
  brake: (active) => {
    touch.brake = active;
  },
  leanFwd: (active) => {
    touch.leanFwd = active;
  },
  nitro: (active) => {
    touch.nitro = active;
  },
});
```

- [ ] **Step 6: Verify types compile**

Run: `pnpm lint`
Expected: no type errors (the `onNitro?` optional-call mismatch from Task 1 is now resolved).

- [ ] **Step 7: Manual verification in Chrome DevTools**

Run: `pnpm dev` (note the printed local URL), open it in Chrome, open DevTools → toggle device toolbar (Cmd+Shift+M) → pick any touch device preset in landscape.

Confirm:

- The old full-screen tap-to-brake/throttle behavior is gone (tapping empty canvas does nothing).
- A D-pad renders bottom-left; pressing/holding Up increases the Speed readout, holding Left visibly leans the bike back, holding Right leans it forward, the Down button does nothing and looks visually disabled.
- An "A" button renders bottom-right (circular); holding it drains/engages the nitro meter and glows amber to match, exactly like the old NITRO button used to.
- Resize the DevTools viewport to a non-touch preset (or check "no touch emulation") and confirm neither D-pad nor A button render, and keyboard controls (W/A/D/Shift) still work.

- [ ] **Step 8: Commit**

```bash
git add src/lib/game/hud.ts src/lib/game/game.ts
git commit -m "Add NDS-style D-pad and A button for touch controls"
```

---

### Task 3: Responsive HUD layout for mobile (coarse pointer)

**Files:**

- Modify: `src/lib/game/hud.ts` (CSS block, hint text)

**Interfaces:**

- Consumes: `#oh-dpad` (132×132px, bottom:20px, left:20px) and `#oh-abtn` (72×72px, bottom:20px, right:24px) from Task 2 — this task's repositioning must keep every other HUD element clear of that footprint (top edge of both controls is `20 + max(132, 72) = 152px` from the viewport bottom).
- Produces: touch-specific hint copy shown only when `pointer: coarse` (read once at HUD creation via `matchMedia`).

- [ ] **Step 1: Add a coarse-pointer layout override block to the CSS**

In `hud.ts`, immediately after the existing `#oh-hint b { ... }` rule (end of the "in-run stats" / hint section, right before the `/* ---- results ---- */` comment), add:

```css
/* ---- mobile (coarse pointer) layout overrides ---- */
@media (pointer: coarse) {
  #oh-header {
    padding: 14px 16px 8px;
  }
  #oh-cats {
    margin-bottom: 10px;
  }
  #oh-tabs {
    max-width: 100%;
  }
  #oh-priceblock {
    margin-top: 10px;
  }
  #oh-price {
    font-size: 22px;
  }
  #oh-stats {
    bottom: 168px;
    gap: 8px;
  }
  #oh-stats .oh-stat {
    padding: 6px 10px;
  }
  #oh-speed {
    bottom: 168px;
    padding: 6px 10px;
  }
  #oh-nitro {
    bottom: 100px;
    right: 24px;
    width: 100px;
  }
}
```

- [ ] **Step 2: Swap the hint copy for coarse pointers**

Find (around `hud.ts:297-299`):

```ts
const hint = el("div", "");
hint.id = "oh-hint";
hint.innerHTML = "<b>W</b> gas · <b>A</b> wheelie · <b>D</b> nose dive · <b>Shift</b> nitro";
```

Replace with:

```ts
const hint = el("div", "");
hint.id = "oh-hint";
hint.innerHTML = window.matchMedia("(pointer: coarse)").matches
  ? "<b>&#9650;</b> gas · <b>&#9664;</b> wheelie · <b>&#9654;</b> nose dive · <b>A</b> nitro"
  : "<b>W</b> gas · <b>A</b> wheelie · <b>D</b> nose dive · <b>Shift</b> nitro";
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm lint`
Expected: no type errors.

- [ ] **Step 4: Manual verification in Chrome DevTools**

With `pnpm dev` running, open DevTools device toolbar with a touch device preset in landscape (e.g. a phone in landscape, ~740×360 viewport):

Confirm:

- The header (category tabs, price) is visibly more compact and doesn't wrap awkwardly or get clipped.
- The Distance/Points/Best stat cards (bottom-left) and Speed readout (bottom-right) now sit clearly above the D-pad and A button — no visual overlap.
- The Nitro meter bar sits just above the A button, not overlapping it.
- The bottom-center hint text reads the touch version (arrows + "A nitro") instead of the keyboard version.
- Switch the device toolbar back to a non-touch/desktop preset and confirm the header/stats/hint all look exactly as they did before this task (desktop is unaffected by the `pointer: coarse` media query).

- [ ] **Step 5: Commit**

```bash
git add src/lib/game/hud.ts
git commit -m "Make HUD layout responsive on mobile, avoid D-pad/A-button overlap"
```

---

### Task 4: Rotate-to-landscape prompt

**Files:**

- Modify: `src/lib/game/hud.ts` (CSS block, markup)

**Interfaces:**

- Consumes: nothing from prior tasks (pure CSS + a static DOM node appended to the existing `hud` root element created in `createHud`).
- Produces: `#oh-rotate` element, shown/hidden purely via CSS media query — no JS event listeners needed since media queries re-evaluate automatically on device rotation.

- [ ] **Step 1: Add the rotate-overlay CSS**

In `hud.ts`, at the very end of the `CSS` template string (after the `#oh-loading` / `@keyframes oh-pulse` block, before the closing `` ` ``), add:

```css

/* ---- rotate-to-landscape prompt (coarse pointer + portrait only) ---- */
#oh-rotate {
  display: none; position: fixed; inset: 0; z-index: 50;
  background: #050505; pointer-events: auto;
  flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  text-align: center;
}
.oh-rotate-icon { font-size: 48px; color: ${C.text}; }
.oh-rotate-text { font-size: 14px; letter-spacing: 0.06em; color: ${C.dim}; padding: 0 24px; }
@media (pointer: coarse) and (orientation: portrait) { #oh-rotate { display: flex; } }
```

- [ ] **Step 2: Append the rotate-overlay markup**

Find (around `hud.ts:323-331`, the "results + loading" section):

```ts
// ---- results + loading ----
const results = el("div", "oh-hidden");
results.id = "oh-results";
const loading = el("div", "oh-hidden");
loading.id = "oh-loading";
loading.innerHTML = `<div class="oh-dot"></div><span></span>`;
const loadingMsg = loading.querySelector<HTMLElement>("span")!;
hud.appendChild(results);
hud.appendChild(loading);
```

Replace with:

```ts
// ---- results + loading ----
const results = el("div", "oh-hidden");
results.id = "oh-results";
const loading = el("div", "oh-hidden");
loading.id = "oh-loading";
loading.innerHTML = `<div class="oh-dot"></div><span></span>`;
const loadingMsg = loading.querySelector<HTMLElement>("span")!;
hud.appendChild(results);
hud.appendChild(loading);

// ---- rotate-to-landscape prompt ----
const rotate = el("div", "");
rotate.id = "oh-rotate";
rotate.innerHTML = `<div class="oh-rotate-icon">&#8635;</div><div class="oh-rotate-text">Rotate your device to play</div>`;
hud.appendChild(rotate);
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm lint`
Expected: no type errors.

- [ ] **Step 4: Manual verification in Chrome DevTools**

With `pnpm dev` running, open DevTools device toolbar with a touch device preset:

Confirm:

- Rotating the emulated device to **portrait** immediately covers the whole screen with the dark rotate prompt ("Rotate your device to play"), blocking all interaction with the canvas/HUD/D-pad/A-button underneath.
- Rotating back to **landscape** immediately hides the prompt and the game/D-pad/A-button are interactive again.
- Switching the device toolbar to a non-touch/desktop preset (any orientation) never shows the prompt.

- [ ] **Step 5: Commit**

```bash
git add src/lib/game/hud.ts
git commit -m "Add rotate-to-landscape prompt for portrait touch viewports"
```
