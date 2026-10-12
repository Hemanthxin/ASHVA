import type { Rect } from '../utils/math';

/** Who dealt the damage; used for blocking rules and effects. */
export type HitSource = 'player' | 'enemy' | 'boss' | 'hazard' | 'wave';

export interface HitInfo {
  damage: number;
  /** Direction the target is pushed (+1 right / -1 left). */
  dir: 1 | -1;
  knock: number;
  knockUp: number;
  stun: number;
  heavy: boolean;
  unblockable: boolean;
  source: HitSource;
  /** World position of the impact for effects. */
  ox: number;
  oy: number;
  shadow?: boolean;
  /** Identity of the attack instance, to prevent multi-hits. */
  attacker?: unknown;
}

export type HitResult = 'hit' | 'killed' | 'blocked' | 'parried' | 'dodged' | 'none';

export interface Damageable {
  hurtbox(): Rect;
  hurt(info: HitInfo): HitResult;
  readonly dead: boolean;
}

/** Placeholder-free helper to build the front hitbox of an attacker. */
export function frontBox(cx: number, feetY: number, facing: 1 | -1, reach: number, height: number, offsetY: number, back = 6): Rect {
  const x = facing > 0 ? cx - back : cx - reach + back;
  return { x, y: feetY - offsetY - height, w: reach, h: height };
}

export function hitInfo(partial: Partial<HitInfo> & Pick<HitInfo, 'damage' | 'dir' | 'source' | 'ox' | 'oy'>): HitInfo {
  return {
    knock: 160, knockUp: 0, stun: 0.3, heavy: false, unblockable: false,
    ...partial,
  };
}
