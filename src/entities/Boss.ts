import Phaser from 'phaser';
import { PAL } from '../config/gameConfig';
import { audio } from '../systems/AudioSystem';
import { Body, makeBody, moveBody } from '../systems/MovementSystem';
import { HitInfo, HitResult, hitInfo } from '../systems/CombatSystem';
import { BOSS_STYLE, Pose, drawRig, neutralPose } from '../render/Silhouette';
import type { Hittable, IWorld } from './World';
import { Rect, approach, clamp, overlap, sign, smooth } from '../utils/math';

export type BState =
  | 'DORMANT' | 'IDLE' | 'WALK' | 'SLAM' | 'SWEEP' | 'CHARGE' | 'LEAP' | 'ORBS'
  | 'RECOVER' | 'STAGGER' | 'PHASE' | 'KNEEL' | 'DEAD';

interface Wave { x: number; y: number; dir: 1 | -1; life: number; hit: boolean }
interface Orb { x: number; y: number; tx: number; delay: number; state: 'marker' | 'fall' | 'boom'; t: number; hit: boolean }

export const BOSS_NAME = 'THE ASHEN GUARDIAN';
export const BOSS_MAX_HP = 320;

/**
 * THE ASHEN GUARDIAN - three phases, every attack telegraphed, a recovery window after each.
 * P1 slow melee (slam / sweep). P2 adds ground shockwaves, a charge and a leap slam, faster.
 * P3 adds ash-orb rain and combinations, and ends with a final kneeling vulnerability window.
 */
export class Boss implements Hittable {
  readonly id = 9999;
  readonly isBoss = true;
  readonly g: Phaser.GameObjects.Graphics;
  readonly fxG: Phaser.GameObjects.Graphics;
  body: Body;
  facing: 1 | -1 = -1;
  state: BState = 'DORMANT';
  stateT = 0;
  hp = BOSS_MAX_HP;
  readonly maxHp = BOSS_MAX_HP;
  dead = false;
  phase = 1;
  /** Callbacks wired by the level. */
  onPhase: (n: number) => void = () => {};
  onDefeated: () => void = () => {};

  private t = 0;
  private flashT = 0;
  private decideT = 0.8;
  private lastAttack = '';
  private struck = false;
  private tele = 0;
  private waves: Wave[] = [];
  private orbs: Orb[] = [];
  private orbCd = 4;
  private kneeled = false;
  private invuln = false;
  private chargeHit = false;
  private leapFrom = { x: 0, y: 0 };
  private leapTo = { x: 0, y: 0 };
  private comboLeft = 0;
  private walkPhase = 0;
  private recoverTime = 1;
  private hitFlag = false;
  private deathT = 0;
  private armor = true;
  private stunT = 0;
  private arenaFloor: number;

  constructor(private scene: Phaser.Scene, private w: IWorld, x: number, feetY: number, private arena: [number, number]) {
    this.body = makeBody(x - 28, feetY - 136, 56, 136);
    this.arenaFloor = feetY;
    this.g = scene.add.graphics().setDepth(8);
    this.fxG = scene.add.graphics().setDepth(12);
  }

  get x() { return this.body.x + this.body.w / 2; }
  get y() { return this.body.y + this.body.h; }
  hurtbox(): Rect { return { x: this.body.x + 2, y: this.body.y + 6, w: this.body.w - 4, h: this.body.h - 6 }; }
  get vulnerable() { return this.state === 'RECOVER' || this.state === 'STAGGER' || this.state === 'KNEEL'; }
  get tempo() { return this.phase === 1 ? 1 : this.phase === 2 ? 0.8 : 0.66; }

  private setState(s: BState) {
    this.state = s;
    this.stateT = 0;
    this.struck = false;
    this.hitFlag = false;
  }

  /** Called by the level when the fight starts. */
  awaken() {
    if (this.state === 'DORMANT') {
      this.setState('IDLE');
      this.decideT = 1.2;
      audio.sfx('roar');
      this.w.fx.shake(6, 0.6);
    }
  }

  stun(t: number) {
    if (this.dead || this.invuln) return;
    this.stunT = t;
    this.setState('STAGGER');
    this.body.vx = 0;
  }
  parried() {
    // A parried boss attack leaves it wide open.
    this.stun(2.0);
    this.w.fx.slowmo(0.4, 0.4);
  }

  hurt(info: HitInfo): HitResult {
    if (this.dead || this.state === 'DORMANT') return 'none';
    if (this.invuln || this.state === 'PHASE') {
      this.w.fx.spark(this.x, this.y - 80, info.dir, 4);
      return 'blocked';
    }
    let mul = 1;
    if (this.vulnerable) mul = this.state === 'KNEEL' ? 2 : this.state === 'STAGGER' ? 1.5 : 1.25;
    this.hp -= info.damage * mul;
    this.flashT = 0.1;
    this.hitFlag = true;
    // Phase thresholds.
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
      return 'killed';
    }
    const frac = this.hp / this.maxHp;
    if (this.phase === 1 && frac <= 0.66) this.beginPhase(2);
    else if (this.phase === 2 && frac <= 0.33) this.beginPhase(3);
    else if (this.phase === 3 && frac <= 0.12 && !this.kneeled) this.beginKneel();
    else if (info.heavy && this.vulnerable) this.body.vx = info.dir * 40;
    return 'hit';
  }

  private beginPhase(n: number) {
    this.phase = n;
    this.invuln = true;
    this.waves = [];
    this.orbs = [];
    this.setState('PHASE');
    this.body.vx = 0;
    audio.sfx('roar');
    this.w.fx.shake(9, 0.9);
    this.w.fx.ring(this.x, this.y - 70, PAL.amberHot, 3.5, 0.9);
    this.w.fx.embers(this.x, this.y - 70, 24);
    this.w.atmos.flash(0.35);
    this.onPhase(n);
  }

  private beginKneel() {
    this.kneeled = true;
    this.invuln = false;
    this.waves = [];
    this.orbs = [];
    this.setState('KNEEL');
    this.body.vx = 0;
    audio.sfx('roar', 0.7);
    this.w.fx.shake(5, 0.5);
    this.w.fx.ring(this.x, this.y - 70, PAL.white, 3, 0.8);
    this.w.toast('The chains crack. Strike now!', 2.4);
    this.onPhase(4);
  }

  private die() {
    this.dead = true;
    this.waves = [];
    this.orbs = [];
    this.setState('DEAD');
    this.body.vx = 0;
    this.deathT = 0;
    audio.sfx('roar', 0.6);
    this.w.fx.shake(10, 1.2);
    this.w.fx.slowmo(0.25, 2.2);
    this.w.fx.embers(this.x, this.y - 70, 40);
    this.w.atmos.flash(0.5);
    this.onDefeated();
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    this.t += dt;
    this.stateT += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.orbCd -= dt;
    const w = this.w;
    const p = w.player;
    const dx = p.cx - this.x;
    const adx = Math.abs(dx);
    const b = this.body;
    const tempo = this.tempo;

    this.updateHazards(dt);

    switch (this.state) {
      case 'DORMANT':
        b.vx = 0;
        break;
      case 'IDLE': {
        b.vx = approach(b.vx, 0, 900 * dt);
        this.faceToward(dx);
        this.decideT -= dt;
        if (this.decideT <= 0) this.decide(adx, dx);
        break;
      }
      case 'WALK': {
        this.faceToward(dx);
        const speed = this.phase === 1 ? 92 : this.phase === 2 ? 115 : 135;
        b.vx = approach(b.vx, this.facing * speed, 700 * dt);
        this.walkPhase += Math.abs(b.vx) * dt * 0.03;
        if (this.stateT % 0.55 < dt) {
          this.w.fx.shake(1.4, 0.08);
          audio.sfx('thud');
        }
        if (adx < 175 || this.stateT > 2.5) {
          this.setState('IDLE');
          this.decideT = 0.05;
        }
        break;
      }
      case 'SLAM': {
        b.vx = approach(b.vx, 0, 1200 * dt);
        const tele = 0.95 * tempo;
        if (this.stateT < tele * 0.6) this.faceToward(dx);
        if (!this.struck && this.stateT >= tele) {
          this.struck = true;
          this.slamImpact();
        }
        if (this.stateT >= tele + 0.2) this.endAttack(1.15, 'SLAM');
        break;
      }
      case 'SWEEP': {
        b.vx = approach(b.vx, 0, 1200 * dt);
        const tele = 0.72 * tempo;
        if (this.stateT < tele * 0.6) this.faceToward(dx);
        if (this.stateT >= tele && this.stateT < tele + 0.22) {
          b.vx = this.facing * 120;
          if (!this.struck) {
            this.w.fx.slash(this.x, this.y - 30, this.facing, 40, 210, 0.0, 1.9, PAL.amberHot, 0.3);
            audio.sfx('swingHeavy', 0.6);
            this.w.fx.shake(3, 0.12);
          }
          this.struck = true;
          const box = { x: this.facing > 0 ? this.x : this.x - 215, y: this.y - 54, w: 215, h: 54 };
          this.tryHit(box, 18, 'sweep');
        }
        if (this.stateT >= tele + 0.3) this.endAttack(0.95, 'SWEEP');
        break;
      }
      case 'CHARGE': {
        const tele = 0.65 * tempo;
        if (this.stateT < tele) {
          this.faceToward(dx);
          b.vx = approach(b.vx, 0, 1600 * dt);
          if (Math.random() < 0.3) this.w.fx.dust(this.x - this.facing * 20, this.y - 2, 1);
        } else {
          b.vx = this.facing * 590;
          if (Math.random() < 0.8) this.w.fx.dust(this.x - this.facing * 30, this.y - 2, 1);
          if (this.stateT % 0.2 < dt) this.w.fx.shake(2, 0.1);
          const ph = this.hurtbox();
          if (!this.chargeHit && overlap(ph, p.hurtbox())) {
            const r = p.hurt(hitInfo({
              damage: 24, dir: this.facing, knock: 380, knockUp: 160, stun: 0.5, heavy: true, source: 'boss', ox: p.cx, oy: p.body.y + 30, attacker: this,
            }));
            if (r === 'hit') this.chargeHit = true;
          }
          const hitWall = (this.facing > 0 && this.x > this.arena[1] - 60) || (this.facing < 0 && this.x < this.arena[0] + 60) || b.wall !== 0;
          if (hitWall) {
            // Slammed into the wall: dizzy and vulnerable.
            audio.sfx('slam');
            this.w.fx.shake(9, 0.4);
            this.w.fx.dust(this.x + this.facing * 30, this.y - 40, 10);
            this.w.fx.embers(this.x + this.facing * 30, this.y - 60, 14);
            this.stunT = 2.0;
            b.vx = -this.facing * 100;
            this.setState('STAGGER');
          } else if (this.stateT > tele + 1.1) {
            b.vx *= 0.3;
            this.endAttack(0.9, 'CHARGE');
          }
        }
        break;
      }
      case 'LEAP': {
        const tele = 0.5 * tempo;
        const air = 0.75;
        if (this.stateT < tele) {
          this.faceToward(dx);
          b.vx = 0;
          this.leapFrom = { x: this.x, y: this.y };
          this.leapTo = { x: clamp(p.cx, this.arena[0] + 70, this.arena[1] - 70), y: this.arenaFloor };
        } else if (this.stateT < tele + air) {
          const k = (this.stateT - tele) / air;
          const nx = this.leapFrom.x + (this.leapTo.x - this.leapFrom.x) * smooth(k);
          const ny = this.leapFrom.y - Math.sin(k * Math.PI) * 220;
          b.x = nx - b.w / 2;
          b.y = ny - b.h;
          b.vx = 0;
          b.vy = 0;
          this.faceToward(this.leapTo.x - this.x);
        } else {
          if (!this.struck) {
            this.struck = true;
            b.x = this.leapTo.x - b.w / 2;
            b.y = this.arenaFloor - b.h;
            this.slamImpact(true);
          }
          if (this.stateT >= tele + air + 0.2) this.endAttack(1.1, 'LEAP');
        }
        break;
      }
      case 'ORBS': {
        b.vx = 0;
        const tele = 1.0 * tempo;
        if (this.stateT >= tele && !this.struck) {
          this.struck = true;
          audio.sfx('roar', 1.3);
          this.w.fx.shake(4, 0.3);
          const n = 6;
          for (let i = 0; i < n; i++) {
            const tx = clamp(p.cx + (i - (n - 1) / 2) * 105 + (Math.random() - 0.5) * 40, this.arena[0] + 30, this.arena[1] - 30);
            this.orbs.push({ x: tx, y: this.arenaFloor - 520, tx, delay: 0.12 * i, state: 'marker', t: 0, hit: false });
          }
        }
        if (this.stateT >= tele + 2.2) this.endAttack(1.0, 'ORBS');
        break;
      }
      case 'RECOVER': {
        b.vx = approach(b.vx, 0, 1200 * dt);
        if (this.stateT >= this.recoverTime) {
          if (this.comboLeft > 0) {
            this.comboLeft--;
            this.setState('IDLE');
            this.decideT = 0.05;
          } else {
            this.setState('IDLE');
            this.decideT = (0.5 + Math.random() * 0.5) * this.tempo;
          }
        }
        break;
      }
      case 'STAGGER': {
        b.vx = approach(b.vx, 0, 900 * dt);
        this.stunT -= dt;
        if (this.stunT <= 0) {
          this.setState('IDLE');
          this.decideT = 0.6;
        }
        break;
      }
      case 'PHASE': {
        b.vx = 0;
        if (this.stateT > 1.8) {
          this.invuln = false;
          this.setState('IDLE');
          this.decideT = 0.7;
        }
        break;
      }
      case 'KNEEL': {
        b.vx = 0;
        if (this.stateT > 6.5) {
          // Rises in a final rage: faster, chained attacks.
          this.phase = 3;
          this.comboLeft = 99;
          this.setState('IDLE');
          this.decideT = 0.3;
          audio.sfx('roar');
          this.w.fx.shake(6, 0.5);
          this.w.toast('It rises in fury!', 1.6);
        }
        break;
      }
      case 'DEAD': {
        this.deathT += dt;
        b.vx = 0;
        if (Math.random() < 0.4) this.w.fx.embers(this.x + (Math.random() - 0.5) * 50, this.y - 20 - Math.random() * 100, 2);
        break;
      }
    }

    // keep inside the arena
    if (this.state !== 'LEAP') {
      b.vy = Math.min(900, b.vy + 1900 * dt);
      moveBody(b, this.w.solids, dt);
    }
    if (b.x < this.arena[0]) b.x = this.arena[0];
    if (b.x + b.w > this.arena[1]) b.x = this.arena[1] - b.w;
  }

  private faceToward(dx: number) {
    if (Math.abs(dx) > 8) this.facing = sign(dx) as 1 | -1;
  }

  private decide(adx: number, dx: number) {
    this.faceToward(dx);
    // Chase the player into range first.
    if (adx > 230 && this.phase < 2) {
      this.setState('WALK');
      return;
    }
    const options: string[] = [];
    if (adx <= 230) options.push('SLAM', 'SWEEP');
    if (this.phase >= 2) {
      if (adx > 280) options.push('CHARGE', 'LEAP');
      else options.push('LEAP');
      if (adx > 340) options.push('CHARGE');
    }
    if (this.phase >= 3 && this.orbCd <= 0) options.push('ORBS', 'ORBS');
    if (options.length === 0) {
      this.setState('WALK');
      return;
    }
    // Avoid repeating the same attack twice in a row.
    const filtered = options.filter((o) => o !== this.lastAttack);
    const pick = (filtered.length ? filtered : options)[Math.floor(Math.random() * (filtered.length ? filtered.length : options.length))];
    this.lastAttack = pick;
    if (this.phase === 3 && this.comboLeft === 0 && Math.random() < 0.35) this.comboLeft = 1;
    this.chargeHit = false;
    switch (pick) {
      case 'SLAM': this.setState('SLAM'); break;
      case 'SWEEP': this.setState('SWEEP'); break;
      case 'CHARGE': this.setState('CHARGE'); break;
      case 'LEAP': this.setState('LEAP'); break;
      case 'ORBS':
        this.orbCd = 9;
        this.setState('ORBS');
        break;
    }
    audio.sfx('telegraph', 0.6);
  }

  private endAttack(recover: number, name: string) {
    // A whiffed attack (no hit on the player) leaves the Guardian open longer.
    this.recoverTime = recover * this.tempo * (this.hitFlag ? 1 : 1.2) * (this.comboLeft > 0 ? 0.3 : 1);
    void name;
    this.setState('RECOVER');
  }

  private tryHit(box: Rect, dmg: number, tag: string) {
    if (this.hitFlag) return;
    const p = this.w.player;
    if (!overlap(box, p.hurtbox())) return;
    const r = p.hurt(hitInfo({
      damage: dmg, dir: this.facing, knock: 320, knockUp: 140, stun: 0.45, heavy: true, source: 'boss', ox: p.cx, oy: p.body.y + 30, attacker: this,
    }));
    void tag;
    if (r === 'hit' || r === 'blocked') this.hitFlag = true;
  }

  private slamImpact(leap = false) {
    const w = this.w;
    audio.sfx('slam');
    w.fx.shake(leap ? 10 : 8, 0.35);
    const hx = this.x + this.facing * (leap ? 0 : 90);
    w.fx.dust(hx, this.y - 4, 10);
    w.fx.amber(hx, this.y - 10, 14);
    w.fx.ring(hx, this.y - 6, PAL.amberHot, 2.4, 0.5);
    if (leap) {
      const box = { x: this.x - 150, y: this.y - 80, w: 300, h: 80 };
      this.tryHit(box, 26, 'leap');
    } else {
      const box = { x: this.facing > 0 ? this.x + 10 : this.x - 190, y: this.y - 150, w: 180, h: 150 };
      this.tryHit(box, 28, 'slam');
    }
    if (this.phase >= 2) {
      this.waves.push({ x: hx, y: this.y, dir: 1, life: 1.5, hit: false });
      this.waves.push({ x: hx, y: this.y, dir: -1, life: 1.5, hit: false });
    }
  }

  private updateHazards(dt: number) {
    const p = this.w.player;
    for (const wv of this.waves) {
      wv.life -= dt;
      wv.x += wv.dir * 330 * dt;
      if (Math.random() < 0.6) this.w.fx.embers(wv.x, wv.y - 4, 1);
      if (!wv.hit) {
        const box = { x: wv.x - 14, y: wv.y - 36, w: 28, h: 36 };
        if (overlap(box, p.hurtbox())) {
          const r = p.hurt(hitInfo({
            damage: 14, dir: wv.dir, knock: 260, knockUp: 200, stun: 0.4, source: 'wave', unblockable: true, ox: p.cx, oy: p.feetY - 20,
          }));
          if (r === 'hit') wv.hit = true;
        }
      }
    }
    this.waves = this.waves.filter((wv) => wv.life > 0 && wv.x > this.arena[0] - 40 && wv.x < this.arena[1] + 40);
    for (const o of this.orbs) {
      o.t += dt;
      if (o.state === 'marker') {
        if (o.t > 0.85 + o.delay) {
          o.state = 'fall';
          o.t = 0;
          o.y = this.arenaFloor - 520;
        }
      } else if (o.state === 'fall') {
        o.y += 780 * dt;
        if (o.y >= this.arenaFloor - 10) {
          o.state = 'boom';
          o.t = 0;
          audio.sfx('slam', 1.4);
          this.w.fx.shake(3, 0.12);
          this.w.fx.amber(o.x, this.arenaFloor - 8, 12);
          this.w.fx.ring(o.x, this.arenaFloor - 10, PAL.amber, 1.2, 0.35);
        }
      } else {
        if (!o.hit && o.t < 0.2) {
          const box = { x: o.x - 38, y: this.arenaFloor - 90, w: 76, h: 90 };
          if (overlap(box, p.hurtbox())) {
            const r = p.hurt(hitInfo({
              damage: 16, dir: sign(p.cx - o.x) === 0 ? 1 : (sign(p.cx - o.x) as 1 | -1), knock: 220, knockUp: 200, stun: 0.4, source: 'wave', unblockable: true,
              ox: p.cx, oy: p.feetY - 20,
            }));
            if (r === 'hit') o.hit = true;
          }
        }
      }
    }
    this.orbs = this.orbs.filter((o) => !(o.state === 'boom' && o.t > 0.4));
  }

  // ------------------------------------------------------------------ drawing
  private pose(): Pose {
    const p = neutralPose();
    const t = this.t;
    const s = this.state;
    p.weapon = 1.1;
    p.legF = [0.28, 0.18];
    p.legB = [-0.3, 0.18];
    p.armF = [0.7, 0.8];
    p.armB = [-0.1, 0.5];
    p.lean = 0.05 + Math.sin(t * 1.4) * 0.02;
    switch (s) {
      case 'DORMANT':
        p.lean = 0.35;
        p.head = 0.4;
        p.legF = [0.9, 1.7];
        p.legB = [-0.2, 1.4];
        p.armF = [0.4, 0.6];
        p.weapon = 0.2;
        p.crouch = 1;
        break;
      case 'WALK': {
        const a = this.walkPhase;
        p.legF = [0.5 * Math.sin(a), 0.15 + 0.6 * Math.max(0, Math.cos(a))];
        p.legB = [-0.5 * Math.sin(a), 0.15 + 0.6 * Math.max(0, -Math.cos(a))];
        p.lean = 0.12;
        p.weapon = 0.9;
        break;
      }
      case 'SLAM': {
        const tele = 0.95 * this.tempo;
        if (this.stateT < tele) {
          const k = smooth(this.stateT / tele);
          p.weapon = 1.1 + (3.5 - 1.1) * k;
          p.armF = [p.weapon * 0.8, 0.3];
          p.lean = -0.3 * k;
          p.legF = [0.4, 0.5];
          p.legB = [-0.5, 0.4];
        } else {
          const k = Math.min(1, (this.stateT - tele) / 0.12);
          p.weapon = 3.5 - 3.3 * smooth(k);
          p.armF = [p.weapon * 0.85, 0.15];
          p.lean = 0.7;
          p.legF = [0.8, 0.4];
          p.legB = [-0.7, 0.4];
        }
        break;
      }
      case 'SWEEP': {
        const tele = 0.72 * this.tempo;
        if (this.stateT < tele) {
          const k = smooth(this.stateT / tele);
          p.weapon = 1.1 - 2.9 * k;
          p.armF = [-0.9 * k, 0.5];
          p.lean = -0.25 * k;
          p.legF = [0.5, 0.5];
          p.legB = [-0.6, 0.5];
        } else {
          const k = Math.min(1, (this.stateT - tele) / 0.22);
          p.weapon = -1.8 + 3.6 * smooth(k);
          p.armF = [p.weapon * 0.8, 0.1];
          p.lean = 0.5 * k;
          p.legF = [0.8, 0.3];
          p.legB = [-0.6, 0.3];
        }
        break;
      }
      case 'CHARGE': {
        const tele = 0.65 * this.tempo;
        if (this.stateT < tele) {
          p.lean = 0.6;
          p.legF = [1.0, 1.8];
          p.legB = [-0.3, 1.5];
          p.crouch = 1;
          p.weapon = -1.5;
          p.armF = [-0.8, 0.5];
        } else {
          p.lean = 0.9;
          const a = this.t * 22;
          p.legF = [0.9 * Math.sin(a), 0.3 + 0.9 * Math.max(0, Math.cos(a))];
          p.legB = [-0.9 * Math.sin(a), 0.3 + 0.9 * Math.max(0, -Math.cos(a))];
          p.weapon = 0.2;
          p.armF = [1.3, 0.1];
        }
        break;
      }
      case 'LEAP': {
        const tele = 0.5 * this.tempo;
        if (this.stateT < tele) {
          p.lean = 0.5;
          p.crouch = 1;
          p.legF = [1.1, 1.9];
          p.legB = [-0.2, 1.5];
          p.weapon = 3.0;
          p.armF = [2.4, 0.2];
        } else if (this.stateT < tele + 0.75) {
          p.lean = 0.1;
          p.legF = [1.0, 1.6];
          p.legB = [0.3, 1.2];
          p.weapon = 3.3;
          p.armF = [2.7, 0.1];
          p.lift = 5;
        } else {
          p.lean = 0.7;
          p.weapon = 0.2;
          p.armF = [0.3, 0.1];
          p.legF = [0.8, 0.5];
          p.legB = [-0.6, 0.4];
        }
        break;
      }
      case 'ORBS': {
        const k = smooth(Math.min(1, this.stateT / (0.9 * this.tempo)));
        p.weapon = 1.1 + 2.3 * k;
        p.armF = [2.6 * k, 0.2];
        p.armB = [2.4 * k, 0.2];
        p.lean = -0.2 * k;
        p.legF = [0.4, 0.3];
        p.legB = [-0.4, 0.3];
        break;
      }
      case 'RECOVER':
        p.lean = 0.55;
        p.head = 0.3;
        p.weapon = 0.3;
        p.armF = [0.4, 0.2];
        p.legF = [0.5, 0.8];
        p.legB = [-0.3, 0.6];
        break;
      case 'STAGGER':
        p.lean = -0.4 + Math.sin(this.t * 14) * 0.04;
        p.head = -0.5;
        p.weapon = -0.6;
        p.armF = [-0.8, 0.4];
        p.armB = [-0.5, 0.5];
        p.legF = [0.3, 0.9];
        p.legB = [-0.4, 0.7];
        break;
      case 'PHASE': {
        p.lean = -0.3;
        p.head = -0.5;
        p.armF = [2.5, 0.3];
        p.armB = [2.3, 0.3];
        p.weapon = 3.0;
        p.legF = [0.4, 0.4];
        p.legB = [-0.5, 0.4];
        break;
      }
      case 'KNEEL':
        p.lean = 0.45;
        p.head = 0.6;
        p.legF = [1.4, 2.2];
        p.legB = [-0.2, 1.9];
        p.armF = [0.3, 0.3];
        p.weapon = 0.0;
        p.crouch = 1;
        break;
      case 'DEAD': {
        p.lean = 0.5 + Math.min(0.5, this.deathT * 0.3);
        p.head = 0.8;
        p.legF = [1.45, 2.3];
        p.legB = [-0.1, 2.0];
        p.armF = [0.2, 0.2];
        p.weapon = 0.0;
        break;
      }
      default:
        break;
    }
    return p;
  }

  draw() {
    const g = this.g;
    const fg = this.fxG;
    g.clear();
    fg.clear();
    const x = this.x;
    const y = this.y;
    const f = this.facing;
    // ---- danger indicators
    const tele = this.teleProgress();
    if (tele > 0) {
      const a = 0.08 + 0.25 * tele;
      fg.fillStyle(PAL.crimsonHot, a);
      if (this.state === 'SLAM') fg.fillRect(f > 0 ? x + 10 : x - 190, y - 150, 180, 150);
      else if (this.state === 'SWEEP') fg.fillRect(f > 0 ? x : x - 215, y - 54, 215, 54);
      else if (this.state === 'LEAP') {
        fg.fillCircle(this.leapTo.x, this.arenaFloor - 4, 30 + 120 * tele);
      } else if (this.state === 'CHARGE') {
        fg.fillRect(f > 0 ? x : this.arena[0], y - 40, f > 0 ? this.arena[1] - x : x - this.arena[0], 40);
      } else if (this.state === 'ORBS') {
        fg.lineStyle(2, PAL.amberHot, 0.5 * tele);
        fg.strokeCircle(x, y - 140, 30 + tele * 25);
      }
    }
    // orbs & waves
    for (const o of this.orbs) {
      if (o.state === 'marker') {
        const k = Math.min(1, o.t / (0.85 + o.delay));
        fg.lineStyle(2, PAL.crimsonHot, 0.3 + 0.6 * k);
        fg.strokeCircle(o.x, this.arenaFloor - 6, 38 - k * 12);
        fg.fillStyle(PAL.crimsonHot, 0.08 + 0.2 * k);
        fg.fillCircle(o.x, this.arenaFloor - 6, 38);
      } else if (o.state === 'fall') {
        fg.fillStyle(PAL.amber, 0.25);
        fg.fillCircle(o.x, o.y, 26);
        fg.fillStyle(PAL.amberHot, 1);
        fg.fillCircle(o.x, o.y, 11);
        fg.fillStyle(PAL.obsidian, 1);
        fg.fillCircle(o.x, o.y, 6);
      } else {
        const k = o.t / 0.4;
        fg.fillStyle(PAL.amberHot, 0.7 * (1 - k));
        fg.fillCircle(o.x, this.arenaFloor - 10, 20 + 40 * k);
      }
    }
    for (const wv of this.waves) {
      fg.fillStyle(PAL.amber, 0.35);
      fg.fillTriangle(wv.x - wv.dir * 30, wv.y, wv.x, wv.y - 38, wv.x + wv.dir * 6, wv.y);
      fg.fillStyle(PAL.amberHot, 0.9);
      fg.fillTriangle(wv.x - wv.dir * 14, wv.y, wv.x, wv.y - 24, wv.x + wv.dir * 4, wv.y);
    }

    // ---- boss body
    const alpha = this.state === 'DEAD' ? Math.max(0, 1 - Math.max(0, this.deathT - 1.4) / 1.4) : 1;
    if (alpha <= 0) {
      g.setVisible(false);
      return;
    }
    const pose = this.pose();
    const glow = this.state === 'PHASE' ? 1 : this.tempoGlow();
    // Rim light in ember colour as the encounter heats up.
    drawRig(g, x, y, f, pose, BOSS_STYLE, {
      alpha, eyeGlow: this.state === 'DORMANT' ? 0.15 : 1, flash: this.flashT / 0.1,
      rimColor: this.phase >= 2 ? PAL.amber : PAL.stormLight, rimAlpha: 0.45 + glow * 0.4,
      weaponGlow: glow > 0.5 ? 1 : 0,
    });
    // Glowing cracks on the torso, brighter each phase.
    const crackA = (0.25 + this.phase * 0.2) * alpha * (this.state === 'DORMANT' ? 0.3 : 1);
    g.lineStyle(2, PAL.amberHot, crackA);
    const bx = x + f * 4;
    g.beginPath();
    g.moveTo(bx - 8, y - 112);
    g.lineTo(bx - 2, y - 98);
    g.lineTo(bx - 10, y - 86);
    g.lineTo(bx + 2, y - 72);
    g.strokePath();
    g.beginPath();
    g.moveTo(bx + 10, y - 104);
    g.lineTo(bx + 4, y - 90);
    g.lineTo(bx + 12, y - 78);
    g.strokePath();
    // Broken chains hanging from the wrists.
    g.lineStyle(2.4, PAL.charcoal, alpha);
    for (let i = 0; i < 5; i++) {
      const cx = x - f * 22 + Math.sin(this.t * 2 + i) * 2;
      const cy = y - 70 + i * 9;
      g.strokeCircle(cx, cy, 3);
    }
    if (this.state === 'KNEEL') {
      g.lineStyle(2, PAL.white, 0.5 + Math.sin(this.t * 10) * 0.3);
      g.strokeCircle(x, y - 70, 70 + Math.sin(this.t * 6) * 4);
    }
    if (this.state === 'STAGGER') {
      g.lineStyle(2, PAL.amberHot, 0.8);
      g.strokeCircle(x, y - 148, 12 + Math.sin(this.t * 12) * 2);
    }
    if (this.invuln) {
      g.lineStyle(3, PAL.amberHot, 0.35 + Math.sin(this.t * 24) * 0.25);
      g.strokeCircle(x, y - 70, 95);
    }
  }

  private tempoGlow() {
    return this.state === 'SLAM' || this.state === 'SWEEP' || this.state === 'ORBS' ? this.teleProgress() : this.phase === 3 ? 0.6 : 0;
  }

  private teleProgress(): number {
    const tm = this.tempo;
    switch (this.state) {
      case 'SLAM': return clamp(this.stateT / (0.95 * tm), 0, 1) >= 1 ? 0 : clamp(this.stateT / (0.95 * tm), 0, 1);
      case 'SWEEP': return this.stateT / (0.72 * tm) >= 1 ? 0 : this.stateT / (0.72 * tm);
      case 'LEAP': return this.stateT < 0.5 * tm + 0.75 ? clamp(this.stateT / (0.5 * tm + 0.75), 0.15, 1) : 0;
      case 'CHARGE': return this.stateT / (0.65 * tm) >= 1 ? 0 : this.stateT / (0.65 * tm);
      case 'ORBS': return this.stateT / (1.0 * tm) >= 1 ? 0 : this.stateT / (1.0 * tm);
      default: return 0;
    }
  }

  destroy() {
    this.g.destroy();
    this.fxG.destroy();
  }
}
