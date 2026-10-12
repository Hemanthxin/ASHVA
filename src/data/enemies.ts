export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  w: number;
  h: number;
  patrolSpeed: number;
  chaseSpeed: number;
  sight: number;
  /** attack timings */
  telegraph: number;
  strike: number;
  recover: number;
  reach: number;
  damage: number;
  knock: number;
  /** Chance (0..1) to drop an ember pickup on death. */
  drop: number;
}

export const ENEMIES: Record<'sentinel' | 'wraith' | 'elite', EnemyDef> = {
  sentinel: {
    id: 'sentinel', name: 'Fortress Sentinel', hp: 44, w: 24, h: 56, patrolSpeed: 52, chaseSpeed: 128, sight: 300,
    telegraph: 0.55, strike: 0.14, recover: 0.75, reach: 74, damage: 14, knock: 220, drop: 0.55,
  },
  wraith: {
    id: 'wraith', name: 'Sanctum Wraith', hp: 42, w: 26, h: 52, patrolSpeed: 60, chaseSpeed: 110, sight: 340,
    telegraph: 0.62, strike: 0.16, recover: 0.85, reach: 66, damage: 12, knock: 200, drop: 0.8,
  },
  elite: {
    id: 'elite', name: 'Sanctum Elite', hp: 110, w: 30, h: 66, patrolSpeed: 50, chaseSpeed: 135, sight: 340,
    telegraph: 0.5, strike: 0.16, recover: 0.65, reach: 92, damage: 20, knock: 300, drop: 1,
  },
};
