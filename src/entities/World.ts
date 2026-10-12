import type Phaser from 'phaser';
import type { Solid } from '../systems/MovementSystem';
import type { Damageable, HitInfo } from '../systems/CombatSystem';
import type { Fx } from '../render/Fx';
import type { ShadowDebt } from '../systems/ShadowDebtSystem';
import type { Atmosphere } from '../render/Atmosphere';
import type { Player } from './Player';

/** Anything the player can hit. */
export interface Hittable extends Damageable {
  readonly id: number;
  x: number; // centre x
  y: number; // feet y
  stun(t: number): void;
  isBoss: boolean;
  /** Called when the player parries this entity's attack. */
  parried(): void;
}

/** The slice of the level scene that entities may touch. */
export interface IWorld {
  solids: Solid[];
  hittables: Hittable[];
  ropes: import('../data/types').RopeDef[];
  player: Player;
  fx: Fx;
  debt: ShadowDebt;
  atmos: Atmosphere;
  t: number;
  /** Area-of-effect / projectile damage against the player. */
  hitPlayer(info: HitInfo): string;
  toast(text: string, time?: number): void;
  spawnPickup(x: number, y: number, kind: 'ember'): void;
  playerDied(): void;
  /** Called by the player when a parry succeeds (for slow-mo etc.). */
  onParry(target: Hittable | null): void;
  onEnemyKilled(e: Hittable): void;
}
