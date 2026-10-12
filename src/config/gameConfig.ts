/** Global tunables and palette. Logical height is fixed; width adapts to the screen aspect ratio. */
export const VIEW_H = 540;
export const VIEW_MIN_W = 840; // 14:9
export const VIEW_MAX_W = 1200; // ~20:9

export const PAL = {
  obsidian: 0x05070b,
  night: 0x0a0e16,
  charcoal: 0x1a1f29,
  slate: 0x2a3140,
  storm: 0x2b3f5c,
  stormLight: 0x4a6a8f,
  forest: 0x1e2f2a,
  forestLight: 0x3b5648,
  mud: 0x3a2d22,
  mudLight: 0x5a4636,
  amber: 0xe0a040,
  amberHot: 0xffd27a,
  crimson: 0xa01826,
  crimsonHot: 0xff3b3b,
  moon: 0xcfe0f2,
  white: 0xf4f8ff,
  shadow: 0x7a5cff,
} as const;

export const PHYS = {
  gravity: 1900,
  maxFall: 980,
  walkSpeed: 215,
  sprintSpeed: 325,
  groundAccel: 2600,
  groundDecel: 3000,
  airAccel: 1700,
  airDecel: 650,
  jumpVel: 640,
  jumpCut: 0.45,
  coyote: 0.1,
  jumpBuffer: 0.13,
  wallSlideSpeed: 95,
  wallJumpVx: 270,
  wallJumpVy: 590,
  wallJumpLock: 0.17,
  slideSpeed: 400,
  slideTime: 0.55,
  slideCooldown: 0.25,
  dodgeSpeed: 520,
  dodgeTime: 0.22,
  dodgeCooldown: 0.55,
  playerW: 22,
  playerH: 52,
  slideH: 26,
} as const;

export const SAVE_KEY = 'ashva.save.v1';
export const SETTINGS_KEY = 'ashva.settings.v1';
export const SAVE_VERSION = 1;
