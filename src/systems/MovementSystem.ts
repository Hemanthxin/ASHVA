import type { Rect } from '../utils/math';

export type SolidKind = 'solid' | 'oneway' | 'crumble' | 'moving' | 'shadow';

/** Runtime collision rect. Moving platforms update x/y and publish their per-step delta. */
export interface Solid extends Rect {
  id?: string;
  kind: SolidKind;
  /** When false the solid is ignored (open gates, fallen crumble tiles, hidden shadow bridges). */
  active: boolean;
  dx: number;
  dy: number;
  // crumble state
  crumble?: number; // seconds until it falls once triggered (<0 = idle)
  fallen?: number; // seconds until it respawns after falling
  baseX?: number;
  baseY?: number;
  /** Index into the view list so visuals can follow. */
  view?: any;
}

export interface Body extends Rect {
  vx: number;
  vy: number;
  onGround: boolean;
  groundSolid: Solid | null;
  wall: -1 | 0 | 1;
  wallSolid: Solid | null;
  hitCeil: boolean;
  /** While > 0 the body falls through one-way platforms. */
  dropThrough: number;
  /** A solid that is passed through sideways (used by vaulting). */
  ignore: Solid | null;
}

export const makeBody = (x: number, y: number, w: number, h: number): Body => ({
  x, y, w, h, vx: 0, vy: 0, onGround: false, groundSolid: null, wall: 0, wallSolid: null, hitCeil: false, dropThrough: 0, ignore: null,
});

const overlaps = (b: Rect, s: Rect) => b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y;

/**
 * Swept axis-separated AABB movement. X is resolved first, then Y, which gives reliable platform
 * behaviour at any frame rate when combined with the fixed timestep used by LevelScene.
 */
export function moveBody(b: Body, solids: Solid[], dt: number, stepUp = 7) {
  // Ride moving platforms.
  const gs = b.groundSolid;
  if (gs && gs.kind === 'moving' && gs.active) {
    b.x += gs.dx;
    b.y += gs.dy;
  }
  b.wall = 0;
  b.wallSolid = null;
  b.hitCeil = false;
  const wasGround = b.onGround;
  const px = b.x;

  // ---- X axis
  b.x += b.vx * dt;
  for (const s of solids) {
    if (!s.active || s.kind === 'oneway' || s === b.ignore) continue;
    if (!overlaps(b, s)) continue;
    const feet = b.y + b.h;
    // Small ledges: step up instead of stopping dead.
    if (wasGround && s.y < feet && feet - s.y <= stepUp && b.vy >= 0 && !blockedAbove(b, solids, s)) {
      b.y = s.y - b.h;
      continue;
    }
    if (b.vx > 0 || (b.vx === 0 && px + b.w <= s.x + 0.01)) {
      b.x = s.x - b.w;
      b.wall = 1;
    } else if (b.vx < 0 || (b.vx === 0 && px >= s.x + s.w - 0.01)) {
      b.x = s.x + s.w;
      b.wall = -1;
    } else {
      // Pushed into by a moving platform: resolve by smallest penetration.
      const left = b.x + b.w - s.x;
      const right = s.x + s.w - b.x;
      if (left < right) {
        b.x -= left;
        b.wall = 1;
      } else {
        b.x += right;
        b.wall = -1;
      }
    }
    b.wallSolid = s;
    b.vx = 0;
  }

  // ---- Y axis
  const prevBottom = b.y + b.h;
  b.y += b.vy * dt;
  b.onGround = false;
  b.groundSolid = null;
  for (const s of solids) {
    if (!s.active) continue;
    if (!overlaps(b, s)) continue;
    const topOnly = s.kind === 'oneway' || s === b.ignore;
    if (topOnly) {
      if (b.vy >= 0 && prevBottom <= s.y + 2 + Math.max(0, s.dy) && !(s.kind === 'oneway' && b.dropThrough > 0)) {
        b.y = s.y - b.h;
        b.vy = 0;
        b.onGround = true;
        b.groundSolid = s;
      }
      continue;
    }
    if (b.vy > 0 || (b.vy === 0 && prevBottom <= s.y + 0.01 + Math.max(0, s.dy))) {
      b.y = s.y - b.h;
      b.vy = 0;
      b.onGround = true;
      b.groundSolid = s;
    } else if (b.vy < 0) {
      b.y = s.y + s.h;
      b.vy = 0;
      b.hitCeil = true;
    } else {
      // Zero vertical velocity but overlapping (e.g. crushed by platform): push up.
      b.y = s.y - b.h;
      b.onGround = true;
      b.groundSolid = s;
    }
  }
}

function blockedAbove(b: Body, solids: Solid[], step: Solid): boolean {
  const test = { x: b.x, y: step.y - b.h, w: b.w, h: b.h };
  for (const s of solids) {
    if (!s.active || s.kind === 'oneway' || s === step || s === b.ignore) continue;
    if (overlaps(test, s)) return true;
  }
  return false;
}

/** True when the rect overlaps any active, non-oneway solid. */
export function rectBlocked(r: Rect, solids: Solid[]): boolean {
  for (const s of solids) {
    if (!s.active || s.kind === 'oneway') continue;
    if (overlaps(r, s)) return true;
  }
  return false;
}

/** Is there standable ground at point (x,y)? Used by patrol ledge checks. */
export function groundAt(x: number, y: number, solids: Solid[]): boolean {
  for (const s of solids) {
    if (!s.active) continue;
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + Math.max(s.h, 14)) return true;
  }
  return false;
}

/** Touching a wall within `probe` px on the given side (-1 left / 1 right)? */
export function wallProbe(b: Body, dir: -1 | 1, solids: Solid[], probe = 2): Solid | null {
  const r = { x: dir > 0 ? b.x + b.w : b.x - probe, y: b.y + 4, w: probe, h: b.h - 8 };
  for (const s of solids) {
    if (!s.active || s.kind === 'oneway' || s.kind === 'crumble') continue;
    if (overlaps(r, s)) return s;
  }
  return null;
}

/** Advance moving/crumbling solids by dt. `t` is the global scene time. */
export function updateSolids(solids: Solid[], dt: number, t: number, moves: Map<Solid, { dx: number; dy: number; period: number; phase: number }>) {
  for (const s of solids) {
    if (s.kind === 'moving') {
      const m = moves.get(s);
      if (!m) continue;
      const k = Math.sin(((t / m.period) + m.phase) * Math.PI * 2);
      const nx = s.baseX! + m.dx * 0.5 * (k + 1);
      const ny = s.baseY! + m.dy * 0.5 * (k + 1);
      s.dx = nx - s.x;
      s.dy = ny - s.y;
      s.x = nx;
      s.y = ny;
    } else if (s.kind === 'crumble') {
      if (s.fallen !== undefined && s.fallen > 0) {
        s.fallen -= dt;
        if (s.fallen <= 0) {
          s.active = true;
          s.fallen = 0;
          s.crumble = -1;
          s.y = s.baseY!;
        }
      } else if (s.crumble !== undefined && s.crumble > 0) {
        s.crumble -= dt;
        if (s.crumble <= 0) {
          s.active = false;
          s.fallen = 3.2;
        }
      }
    }
  }
}
