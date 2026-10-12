/** Player attack data. All times in seconds; the hitbox is only live during the `active` window. */
export interface AttackDef {
  id: string;
  windup: number;
  active: number;
  recover: number;
  /** Time after `windup+active` during which the next combo input is accepted. */
  link: number;
  damage: number;
  reach: number; // hitbox width in front of the body
  height: number;
  offsetY: number; // hitbox bottom above feet
  knock: number;
  knockUp: number;
  stun: number;
  lunge: number;
  heavy: boolean;
  /** Swing arc for the weapon (rig angles; 0=down, +forward, PI=up) and trail colour. */
  from: number;
  to: number;
  windFrom: number;
  sfx: 'swing' | 'swingHeavy';
  shake: number;
}

export const BLADE: Record<'light1' | 'light2' | 'light3' | 'heavy', AttackDef> = {
  light1: {
    id: 'light1', windup: 0.07, active: 0.09, recover: 0.17, link: 0.3, damage: 10, reach: 58, height: 46, offsetY: 4,
    knock: 130, knockUp: 0, stun: 0.28, lunge: 120, heavy: false, from: 3.0, to: 0.7, windFrom: 3.6, sfx: 'swing', shake: 0,
  },
  light2: {
    id: 'light2', windup: 0.06, active: 0.09, recover: 0.17, link: 0.3, damage: 12, reach: 62, height: 46, offsetY: 4,
    knock: 150, knockUp: 0, stun: 0.3, lunge: 140, heavy: false, from: 0.2, to: 2.9, windFrom: -0.4, sfx: 'swing', shake: 0,
  },
  light3: {
    id: 'light3', windup: 0.12, active: 0.11, recover: 0.3, link: 0, damage: 18, reach: 70, height: 60, offsetY: 0,
    knock: 260, knockUp: 160, stun: 0.45, lunge: 190, heavy: false, from: 3.5, to: 0.4, windFrom: 4.0, sfx: 'swingHeavy', shake: 2,
  },
  heavy: {
    id: 'heavy', windup: 0.26, active: 0.12, recover: 0.38, link: 0, damage: 30, reach: 76, height: 66, offsetY: 0,
    knock: 380, knockUp: 120, stun: 0.7, lunge: 150, heavy: true, from: 3.8, to: 0.3, windFrom: 4.3, sfx: 'swingHeavy', shake: 4,
  },
};

export const COMBO: Array<keyof typeof BLADE> = ['light1', 'light2', 'light3'];
