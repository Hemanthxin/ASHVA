# ASHVA: Rise of the Forgotten

A cinematic 2.5D silhouette action-platformer for desktop **and mobile** browsers.
Parkour across storm-lit fortress rooftops, uncover a drowned kingdom's mythology, and duel an ancient guardian — with a calm, synthesized "shadow garden" score and a scripted cinematic opening.

Everything — art, animation, music, sound effects, cinematics — is **original and generated in code**. No external asset files exist, so nothing can fail to load.

* TypeScript · Phaser 3 (WebGL/Canvas) · Vite · Web Audio API · LocalStorage
* No backend, accounts, paid APIs or network requests at runtime.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (also exposed on your LAN, e.g. to try it on a phone)
npm run build      # type-checks (tsc) then builds to dist/
npm run preview    # serves the production build on http://localhost:4173
```

Open the LAN URL printed by `npm run dev` on a phone (same Wi-Fi) to test touch controls.
Rotate to landscape; use **Fullscreen** in the menu for the best result.

## What you can play

| Chapter | Content |
|---|---|
| **I – The Broken Order** (2 parts) | Cinematic intro → movement tutorial → rooftop traversal → timed **chase** → first weapon → shadow altar → sentinel arena → collapsing-wall escape → stormy wood (wraiths, hidden shadow bridge) → story reveal |
| **II – The Drowned Village** | Flooded ruins, three-lamp puzzle (one lamp hidden in a cellar), lore tablets, wraith/sentinel arena, the Shrine of Still Water |
| **III – Beneath the Earth** | Swinging blades, spikes, crumbling stairs, ash-fall traps, moving platforms, elite sentinels, **THE ASHEN GUARDIAN** (3 phases + final vulnerability) |

Chapters 4+ are **not** implemented; the final screen says so.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | `A` `D` / `←` `→` | floating stick (left half) |
| Sprint | `Shift` | push the stick fully |
| Jump (hold = higher) | `Space` | JUMP button / flick stick up |
| Slide / crouch | `S` / `↓` | pull stick down |
| Vault | run into a low obstacle | same |
| Wall-jump | `Space` on a wall, then again | JUMP on a wall |
| **Climb ropes** | `W` / `↑` near a rope; `W`/`S` to move; direction + `Space` to leap off (reaching the top hops you onto the ledge) | pull the stick up near a rope; direction + JUMP to leap off |
| Light attack (3-hit combo) | `J` | STRIKE |
| Heavy attack | `K` | HEAVY |
| Guard / **parry** | hold `U` (tap just before a hit to parry) | GUARD |
| Dodge (i-frames) | `L` | DODGE |
| Shadow Dash | `I` | SHADOW |
| Interact | `E` | USE (appears near things) |
| Pause | `Esc` / `P` | ‖ button |

Combat buttons appear on touch only after the blade / shadow power are found.

## Systems

* **Shadow Debt** – every Shadow Dash adds debt. Visible on the HUD, as a violet world tint and a lagging "shadow double". At **40 %** hidden shadow bridges become solid; past **50 %** enemies are bolder (faster telegraphs/chase) and dash damage grows (×1.3 → ×1.6); at **100 %** the shadow refuses to answer. Pay it down at **lamps of rest** (−50 and full heal), with **embers** dropped by foes (−8), and by **parrying** (−6). Abilities are data-driven (`ShadowAbility`) so more can be added.
* **Combat** – hitboxes are active only in each attack's active window and hit each target once; anticipation / strike / recovery phases; 3-hit light combo + heavy finisher; knock-back, hit-stop, restrained screen shake, slow-mo on parries/kills; guard & perfect-parry; dodge i-frames.
* **Enemies** (explicit state machines `PATROL → ALERT → CHASE → ATTACK → RECOVER → HURT → DEAD`): **Fortress Sentinel** (patrol, sight cone, telegraphed spear thrust, longer opening after a whiff), **Sanctum Elite** (armoured two-hit combo), **Sanctum Wraith** (hovers, keeps distance, blinks behind you, red-ring telegraph, double-swipe at high debt).
* **Boss** – telegraphed slam / sweep (P1), + ground shockwaves, charge (stuns itself on walls), leap slam (P2), + ash-orb rain and combos (P3), kneeling final window. Parrying a boss attack leaves it wide open.
* **Ropes & high places** – ropes hang from tall ledges (chimney in Chapter I, a cellar and a broken eave in Chapter II, a balcony in Chapter III, a high ledge in the wood). Climbing is a proper player state; ropes lead to optional relics and give an alternative to wall-jumping.
* **Surprise obstacles** (always telegraphed): hidden floor spikes that burst up after a click-and-dust warning, rocks that rumble loose from the ceiling (red landing marker), wall dart turrets (glint before each shot; darts can be blocked or parried), and ambushes where enemies burst out of the shadows when you cross a point.
* **Camera** – look-ahead, dead-zone, damped follow, arena locks, scripted focus; adaptive zoom on small screens so characters stay readable on phones; logical width follows the screen aspect (14:9 – 20:9).
* **Save** – versioned schema in LocalStorage (`ashva.save.v1`), validated/sanitised on load (corrupt or too-new data is discarded gracefully). Checkpoints, abilities, relics, max health, debt, deaths and settings are stored; nothing personal.

## Audio

`src/systems/AudioSystem.ts` synthesizes everything with the Web Audio API:
a composed, looping 8-bar piece in D Hirajoshi (warm pad chords, a fixed soft koto arpeggio, a breathy shakuhachi-style melody with vibrato, a deep root note, temple-bell sparkles and gentle taiko) in four moods (*calm*, *sorrow*, *tense*, *boss*), a very soft low-passed rain bed, thunder and ~40 punchy effects (SFX are mixed louder than the music). Audio only starts after the first click/tap/key (browser autoplay rules) and the game is fully playable muted. Volumes: Settings → master / music / effects. **Rain** (Off / Light / Heavy, default *Light*) controls both the rain visuals and the rain sound.

## Architecture

```
src/
  main.ts                    boot, adaptive canvas size, scene flow, audio unlock
  config/gameConfig.ts       palette + physics constants
  core/flow.ts               tiny scene-flow registry + per-chapter session counters
  scenes/
    BootScene.ts             generates shared textures
    MenuScene.ts             title screen (parallax, moon, Aru silhouette)
    IntroScene.ts            scripted cinematic (wall march → symbol → alarm → rooftop chase → leap → title)
    LevelScene.ts            all gameplay: levels, camera, hazards, chase, arenas, boss encounter, HUD glue
  entities/
    Player.ts                finite-state-machine controller (IDLE…DEAD, 16 states)
    Enemy.ts                 Enemy base, Sentinel (+Elite), Wraith
    Boss.ts                  The Ashen Guardian
    World.ts                 interface entities use to talk to the scene
  systems/
    MovementSystem.ts        swept AABB collision, one-ways, moving & crumbling platforms
    CombatSystem.ts          hit info/result types, hitbox helpers
    ShadowDebtSystem.ts      debt meter, stages, ability definitions
    InputSystem.ts           keyboard + touch with buffering / coyote helpers
    AudioSystem.ts           procedural music + SFX
    SaveSystem.ts            versioned save + settings
  render/
    Silhouette.ts            procedural skeletal silhouette rig + cloth
    Backdrop.ts / Atmosphere.ts   parallax, fog, rain, lightning, embers, vignette
    LevelArt.ts              procedural tiles, props, interactables
    Fx.ts                    pooled particles, rings, weapon trails, shake, hit-stop, slow-mo
  data/                      levels (data-driven, built with a small DSL), enemies, weapons, types
  ui/                        DOM HUD, menus, touch controls, CSS
  utils/                     math helpers, generated-texture fallbacks
```

Notes on deviations from the original brief: pause / game-over / chapter-complete are DOM screens (`ui/Menus.ts`) rather than separate Phaser scenes, and the boss fight lives in `LevelScene` + `entities/Boss.ts` rather than a separate `BossScene` (it reuses the level's arena, camera and HUD).

## Asset credits

None required — no third-party art, audio, fonts or code besides Phaser (MIT), Vite (MIT) and TypeScript (Apache-2.0). UI text uses system serif fonts (Palatino / Georgia fallbacks). The setting, characters, mythology and music are original; the game is only *inspired in spirit* by silhouette parkour runners, folk-horror monsoon tales and shadow-duel fighting games.

## Testing

Automated checks used during development (all passing at the time of writing):

* `npm run build` – strict `tsc` + production bundle (≈ 1.4 MB JS / 380 kB gzip, most of it Phaser).
* Headless Chromium drive-through via scripted input (see "Debug hooks"): menu → New Game → intro → skip → level; run/sprint/jump/vault/slide/wall-jump chimney; the whole chase (scripted autopilot) ; combat vs. a sentinel; parry / late-block / unguarded / dodge outcomes; Shadow Dash + debt + shadow-bridge reveal; arena gates close/open; boss phases 1→3 → death; pause / settings / resume / restart / game over / retry; chapter transitions and completion screens; save → Continue → "New Game overwrite" confirm; runtime resize.
* Emulated phone (844×390, touch): touch controls drive the player, pause button, rotate-to-landscape hint.
* Web Audio output level measured non-zero while music/rain play.

Manual test checklist for a human: play Chapter I start to finish; try parrying a sentinel spear; get Shadow Debt ≥ 40 % in the wood (3 dashes) to reveal the hidden bridge and fetch the relic; light the three village lamps; beat the Guardian.

### Debug hooks
Append `?debug` to the URL to expose `window.__game`, `window.__audio` and `window.__ashva` (teleport `tp(x,y)`, `god()`, `debt(n)`, `unlockAll()`, `kill()`, `end()`, `bot()` autopilot, `state()`), and `F2`/`F3` (heal / god mode). Nothing is exposed otherwise.

## Performance

* Parallax layers are pre-rendered once to 1024×512 canvas textures (≈ 2 MB each; only the current theme's textures stay in memory); rain/fog/vignette are tiled sprites; particles are pooled emitters; characters are drawn with a handful of Graphics calls and enemies far from the player skip their updates.
* Fixed 60 Hz simulation step with accumulator (stable physics at 60/120/144 Hz displays); hit-stop and slow-mo scale simulation, not rendering.
* Measured in headless Chromium with software rendering: steady **60 FPS**. That is *not* a real-hardware benchmark — no physical phone or GPU laptop was available. Use *Settings → Reduced visual effects* if a device struggles (halves particles, hides far rain/fog, dims lightning).
* The game pauses automatically when the tab is hidden.

## Known limitations / next milestone

* Not tested on physical devices (iOS Safari in particular: fullscreen API is unavailable on iPhone; audio unlocks on first tap).
* Music and effects are synthesized — functional and calm, but not a composer's score; there is no way for me to *listen* to it, only to verify it runs and produces signal. Expect to tune mix levels.
* Enemy variety is two archetypes + elite + boss; levels are authored with reachability checked analytically and with an autopilot, not play-tested by humans. Expect to tune difficulty and some jump distances.
* Key rebinding and gamepad support are not implemented (input is isolated in `InputSystem.ts`, so both are straightforward additions).
* Next milestone: Chapter IV (the "second debt"), more shadow abilities (veil / pull), checkpoint-restoring of defeated enemies per section, and a settings screen for key bindings.
