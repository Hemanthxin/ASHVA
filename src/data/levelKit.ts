import type { Theme } from '../render/Backdrop';
import type { Mood } from '../systems/AudioSystem';
import type {
  CheckpointDef, EnemySpawn, HazardDef, InteractDef, LevelDef, PropDef, RelicDef, RopeDef, SolidDef, TriggerAction, TriggerDef,
} from './types';

/** Compact builder used to author levels as readable code. */
export class LevelBuilder {
  solids: SolidDef[] = [];
  hazards: HazardDef[] = [];
  ropes: RopeDef[] = [];
  enemies: EnemySpawn[] = [];
  checkpoints: CheckpointDef[] = [];
  relics: RelicDef[] = [];
  props: PropDef[] = [];
  interacts: InteractDef[] = [];
  triggers: TriggerDef[] = [];
  private trigCount = 0;

  /** A thick block whose top surface is at y (rooftops / earth). */
  roof(x: number, y: number, w: number, style: SolidDef['style'] = 'roof', depth = 900) {
    this.solids.push({ x, y, w, h: depth, kind: 'solid', style });
    return this;
  }
  ground(x: number, y: number, w: number, style: SolidDef['style'] = 'ground', depth = 900) {
    return this.roof(x, y, w, style, depth);
  }
  /** One-way thin ledge. */
  ledge(x: number, y: number, w: number, style: SolidDef['style'] = 'ledge') {
    this.solids.push({ x, y, w, h: 14, kind: 'oneway', style });
    return this;
  }
  wall(x: number, y: number, w: number, h: number, style: SolidDef['style'] = 'wall') {
    this.solids.push({ x, y, w, h, kind: 'solid', style });
    return this;
  }
  /** Low crate standing on `groundY`; vaultable. */
  crate(x: number, groundY: number, w = 40, h = 38, style: SolidDef['style'] = 'crate') {
    this.solids.push({ x, y: groundY - h, w, h, kind: 'solid', style });
    return this;
  }
  /** Overhead barrier that leaves `clear` px above `groundY` (needs a slide). */
  beam(x: number, groundY: number, w: number, clear = 40, h = 90) {
    this.solids.push({ x, y: groundY - clear - h, w, h, kind: 'solid', style: 'beam' });
    return this;
  }
  crumble(x: number, y: number, w: number, style: SolidDef['style'] = 'stone') {
    this.solids.push({ x, y, w, h: 26, kind: 'crumble', style });
    return this;
  }
  mover(x: number, y: number, w: number, dx: number, dy: number, period: number, phase = 0, style: SolidDef['style'] = 'stone') {
    this.solids.push({ x, y, w, h: 24, kind: 'moving', style, move: { dx, dy, period, phase } });
    return this;
  }
  /** Hidden bridge that becomes solid and visible at high Shadow Debt. */
  shadow(x: number, y: number, w: number) {
    this.solids.push({ x, y, w, h: 14, kind: 'shadow', style: 'ledge' });
    return this;
  }
  gate(id: string, x: number, y: number, h: number, w = 36, closed = false) {
    this.solids.push({ x, y, w, h, kind: 'solid', style: 'gate', id, closed });
    return this;
  }

  spikes(x: number, y: number, w: number) {
    this.hazards.push({ kind: 'spikes', x, y: y - 22, w, h: 22, damage: 16 });
    return this;
  }
  blade(x: number, y: number, w: number, h: number, period: number, active = 0.5, phase = 0) {
    this.hazards.push({ kind: 'blade', x, y, w, h, period, active, phase, damage: 20 });
    return this;
  }
  ashfall(x: number, y: number, w: number, h: number, period: number, phase = 0) {
    this.hazards.push({ kind: 'ashfall', x, y, w, h, period, active: 0.22, phase, damage: 18 });
    return this;
  }
  fire(x: number, y: number, w: number, h: number, period = 3, active = 0.5, phase = 0) {
    this.hazards.push({ kind: 'fire', x, y: y - h, w, h, period, active, phase, damage: 14 });
    return this;
  }

  /** Climbable rope from y0 (top, at ledge height) down to y1. Press up near it to climb. */
  rope(x: number, y0: number, y1: number, exit: 1 | -1 = 1) {
    this.ropes.push({ x, y0, y1, exit });
    return this;
  }
  /** Wall dart turret at (x,y) firing in direction dir every period seconds (telegraphed by a glint). */
  dart(x: number, y: number, dir: 1 | -1, period = 2.6, phase = 0) {
    this.hazards.push({ kind: 'dart', x, y, w: 18, h: 18, dir, period, phase, damage: 12 });
    return this;
  }
  /** Hidden floor spikes that burst up (after a short warning) when the player gets close. */
  trapSpikes(x: number, groundY: number, w: number, range = 110) {
    this.hazards.push({ kind: 'trapspike', x, y: groundY - 26, w, h: 26, range, damage: 16 });
    return this;
  }
  /** A rock that drops from above when the player walks within range of x. */
  rockfall(x: number, topY: number, groundY: number, range = 90) {
    this.hazards.push({ kind: 'rockfall', x: x - 28, y: topY, w: 56, h: groundY - topY, range, damage: 20 });
    return this;
  }
  /** Surprise enemies burst out of the shadows when the player crosses x. */
  ambush(x: number, spawns: EnemySpawn[], text = 'Ambush!') {
    return this.at(x, { type: 'ambush', spawns, text }, 50);
  }

  sentinel(x: number, groundY: number, patrol?: [number, number], arena?: string) {
    this.enemies.push({ type: 'sentinel', x, y: groundY, patrol, arena });
    return this;
  }
  elite(x: number, groundY: number, patrol?: [number, number], arena?: string) {
    this.enemies.push({ type: 'elite', x, y: groundY, patrol, arena });
    return this;
  }
  wraith(x: number, y: number, zone?: { x0: number; x1: number; y0: number; y1: number }, arena?: string) {
    this.enemies.push({ type: 'wraith', x, y, zone, arena });
    return this;
  }

  checkpoint(id: string, x: number, y: number, name: string) {
    this.checkpoints.push({ id, x, y, name });
    return this;
  }
  relic(id: string, x: number, y: number, kind: RelicDef['kind'] = 'key') {
    this.relics.push({ id, x, y, kind });
    return this;
  }
  prop(type: PropDef['type'], x: number, y: number, extra: Partial<PropDef> = {}) {
    this.props.push({ type, x, y, ...extra });
    return this;
  }
  interact(def: InteractDef) {
    this.interacts.push(def);
    return this;
  }
  trigger(x: number, y: number, w: number, h: number, action: TriggerAction, once = true) {
    this.triggers.push({ id: `t${this.trigCount++}`, x, y, w, h, once, action });
    return this;
  }
  /** Tall trigger column at x (full height). */
  at(x: number, action: TriggerAction, w = 60) {
    return this.trigger(x, -400, w, 2400, action);
  }
  toast(x: number, text: string, time = 4) {
    return this.at(x, { type: 'toast', text, time });
  }
}

export interface LevelMeta {
  id: string;
  chapter: number;
  title: string;
  subtitle: string;
  theme: Theme;
  mood: Mood;
  width: number;
  height: number;
  camRefY: number;
  spawn: { x: number; y: number };
  rain?: boolean;
  relicTotal?: number;
  boss?: LevelDef['boss'];
}

export function finish(b: LevelBuilder, m: LevelMeta): LevelDef {
  return {
    id: m.id,
    chapter: m.chapter,
    title: m.title,
    subtitle: m.subtitle,
    theme: m.theme,
    mood: m.mood,
    width: m.width,
    height: m.height,
    camRefY: m.camRefY,
    spawn: m.spawn,
    rain: m.rain ?? true,
    solids: b.solids,
    hazards: b.hazards,
    ropes: b.ropes,
    enemies: b.enemies,
    checkpoints: b.checkpoints,
    relics: b.relics,
    props: b.props,
    interacts: b.interacts,
    triggers: b.triggers,
    relicTotal: m.relicTotal ?? b.relics.filter((r) => r.kind === 'key').length,
    boss: m.boss,
  };
}
