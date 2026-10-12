import type { Theme } from '../render/Backdrop';
import type { Mood } from '../systems/AudioSystem';

/** Static collision geometry (one rect). */
export type SolidKind = 'solid' | 'oneway' | 'crumble' | 'moving' | 'shadow';
export type SolidStyle = 'roof' | 'wall' | 'ledge' | 'crate' | 'beam' | 'ground' | 'stone' | 'wood' | 'pillar' | 'gate' | 'ruin' | 'water';

export interface SolidDef {
  x: number; y: number; w: number; h: number;
  kind?: SolidKind;
  style?: SolidStyle;
  /** Moving platform: oscillate by (dx,dy) with the given period (s). */
  move?: { dx: number; dy: number; period: number; phase?: number };
  id?: string;
  /** Gate solids start disabled when `closed` is false. */
  closed?: boolean;
}

export type HazardKind = 'spikes' | 'pit' | 'blade' | 'ashfall' | 'fire' | 'dart' | 'trapspike' | 'rockfall';
export interface HazardDef {
  kind: HazardKind;
  x: number; y: number; w: number; h: number;
  /** For timed hazards (blade/ashfall/fire): cycle length and active fraction. */
  period?: number; active?: number; phase?: number;
  damage?: number;
  /** dart: firing direction. trapspike / rockfall: trigger distance (px) around the rect. */
  dir?: 1 | -1;
  range?: number;
}

export type EnemyType = 'sentinel' | 'wraith' | 'elite';
export interface EnemySpawn {
  type: EnemyType;
  x: number; y: number;
  patrol?: [number, number];
  /** Wraith roaming box. */
  zone?: { x0: number; x1: number; y0: number; y1: number };
  /** Spawn only when the arena with this id starts. */
  arena?: string;
  id?: string;
}

/** A climbable rope. Climbing past the top hops the player off toward . */
export interface RopeDef { x: number; y0: number; y1: number; exit: 1 | -1 }

export interface CheckpointDef { id: string; x: number; y: number; name: string }
export interface RelicDef { id: string; x: number; y: number; kind: 'ember' | 'key' | 'lore' }

export type PropType = 'shade' | 'lamp' | 'brazier' | 'banner' | 'statue' | 'tablet' | 'rope' | 'chain' | 'bush' | 'torii' | 'bell' | 'glyph' | 'pole';
export interface PropDef { type: PropType; x: number; y: number; s?: number; w?: number; h?: number; text?: string; id?: string; flip?: boolean }

export type InteractType = 'rest' | 'lore' | 'pickupBlade' | 'altarShadow' | 'lamp' | 'shrineGift' | 'door';
export interface InteractDef {
  id: string; type: InteractType; x: number; y: number;
  prompt?: string; title?: string; text?: string[];
  /** For 'lamp' puzzles: gate id opened once `need` lamps in the group are lit. */
  group?: string; need?: number; opens?: string;
}

export type TriggerAction =
  | { type: 'toast'; text: string; time?: number }
  | { type: 'title'; title: string; sub?: string }
  | { type: 'mood'; mood: Mood }
  | { type: 'chaseStart' }
  | { type: 'chaseEnd' }
  | { type: 'arenaStart'; arena: string; lock: [number, number]; gates?: string[] }
  | { type: 'bossStart' }
  | { type: 'cinematic'; lines: string[]; hold?: number }
  | { type: 'end' }
  | { type: 'hint'; key: 'debt' | 'shadow' | 'combat' | 'parry' | 'wall' | 'rope' }
  | { type: 'ambush'; spawns: EnemySpawn[]; text?: string };

export interface TriggerDef {
  id: string; x: number; y: number; w: number; h: number;
  once?: boolean;
  action: TriggerAction;
}

export interface LevelDef {
  id: string;
  chapter: number;
  title: string;
  subtitle: string;
  theme: Theme;
  mood: Mood;
  width: number;
  height: number; // world height (kill plane = height + 120)
  camRefY: number; // typical camera scrollY, used to anchor parallax
  spawn: { x: number; y: number };
  rain: boolean;
  solids: SolidDef[];
  hazards: HazardDef[];
  ropes: RopeDef[];
  enemies: EnemySpawn[];
  checkpoints: CheckpointDef[];
  relics: RelicDef[];
  props: PropDef[];
  interacts: InteractDef[];
  triggers: TriggerDef[];
  /** Number of optional relics in this chapter (for the summary screen). */
  relicTotal: number;
  /** Boss arena bounds, if any. */
  boss?: { x: number; y: number; arena: [number, number]; gates: string[] };
}
