import Phaser from 'phaser';
import { PAL } from '../config/gameConfig';
import { audio } from '../systems/AudioSystem';
import { Body, groundAt, makeBody, moveBody } from '../systems/MovementSystem';
import { HitInfo, HitResult, frontBox, hitInfo } from '../systems/CombatSystem';
import { ENEMIES, EnemyDef } from '../data/enemies';
import type { EnemySpawn } from '../data/types';
import { ELITE_STYLE, Pose, RigStyle, SENTINEL_STYLE, drawRig, neutralPose } from '../render/Silhouette';
import type { Hittable, IWorld } from './World';
import { Rect, approach, clamp, rng, sign, smooth } from '../utils/math';

export type EState = 'PATROL' | 'ALERT' | 'CHASE' | 'ATTACK' | 'RECOVER' | 'HURT' | 'DEAD';

let nextId = 1;

export abstract class Enemy implements Hittable {
  readonly id = nextId++;
  readonly isBoss = false;
  readonly g: Phaser.GameObjects.Graphics;
  body: Body;
  facing: 1 | -1 = -1;
  state: EState = 'PATROL';
  stateT = 0;
  hp: number;
  dead = false;
  protected t = Math.random() * 10;
  protected flashT = 0;
  protected stunT = 0;
  protected armorT = 0;
  protected vulnerable = false;
  protected fadeT = 0;
  protected phase = 0; // phase inside ATTACK: 0 telegraph, 1 strike, 2 recover
  protected struck = false;
  protected hitLanded = false;
  protected attackCd = 0;
  protected homeX: number;
  protected activeRange = 1300;
  active = true;
  constructor(protected scene: Phaser.Scene, protected w: IWorld, public def: EnemyDef, spawn: EnemySpawn) {
    this.body = makeBody(spawn.x - def.w / 2, spawn.y - def.h, def.w, def.h);
    this.hp = def.hp;
    this.homeX = spawn.x;
    this.g = scene.add.graphics().setDepth(8);
  }

  get x() { return this.body.x + this.body.w / 2; }
  get y() { return this.body.y + this.body.h; }
  hurtbox(): Rect { return { x: this.body.x, y: this.body.y, w: this.body.w, h: this.body.h }; }

  protected setState(s: EState) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
  }

  stun(t: number) {
    if (this.dead) return;
    this.stunT = t;
    this.phase = 0;
    this.setState('HURT');
    this.body.vx = 0;
  }

  /** Used by ambushes: the enemy immediately notices the player. */
  aggro() {
    if (this.dead) return;
    this.setState('ALERT');
  }

  parried() {
    if (this.dead) return;
    this.stun(1.0);
    this.vulnerable = true;
    this.flashT = 0.2;
  }

  protected get aggr() {
    return this.w.debt.aggression;
  }

  hurt(info: HitInfo): HitResult {
    if (this.dead) return 'none';
    const dmg = info.damage * (this.vulnerable ? 1.35 : 1);
    this.hp -= dmg;
    this.flashT = 0.13;
    const strikingNow = this.state === 'ATTACK' && this.phase === 1;
    if (this.hp <= 0) {
      this.die(info);
      return 'killed';
    }
    const armored = this.armorT > 0 || strikingNow || (this.def.id === 'elite' && !info.heavy && this.state === 'ATTACK');
    this.body.vx = info.dir * info.knock * (armored ? 0.15 : 1);
    this.body.vy = -info.knockUp;
    if (!armored) {
      this.stunT = Math.max(0.2, info.stun);
      this.phase = 0;
      this.setState('HURT');
    }
    return 'hit';
  }

  protected die(info: HitInfo) {
    this.dead = true;
    this.state = 'DEAD';
    this.stateT = 0;
    this.fadeT = 0;
    this.body.vx = info.dir * 160;
    this.body.vy = -200;
    audio.sfx('enemyDie');
    this.w.fx.smoke(this.x, this.y - 30, 8);
    this.w.fx.amber(this.x, this.y - 30, 8);
    if (Math.random() < this.def.drop) this.w.spawnPickup(this.x, this.y - 20, 'ember');
  }

  /** Common: advance timers; returns false when the AI should skip this tick. */
  protected tickCommon(dt: number): boolean {
    this.t += dt;
    this.stateT += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.armorT = Math.max(0, this.armorT - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.dead) {
      this.fadeT += dt;
      return false;
    }
    return true;
  }

  abstract update(dt: number): void;
  abstract draw(): void;

  /** Hit the player if the strike hitbox overlaps them. Returns the HitResult. */
  protected strikePlayer(box: Rect, dmgMul = 1, extra: Partial<HitInfo> = {}): HitResult {
    const p = this.w.player;
    const pb = p.hurtbox();
    if (box.x < pb.x + pb.w && box.x + box.w > pb.x && box.y < pb.y + pb.h && box.y + box.h > pb.y) {
      const r = p.hurt(hitInfo({
        damage: Math.round(this.def.damage * dmgMul), dir: this.facing, knock: this.def.knock, knockUp: 60, stun: 0.35,
        heavy: false, source: 'enemy', ox: p.cx, oy: p.body.y + 24, attacker: this, ...extra,
      }));
      if (r === 'hit' || r === 'blocked') this.hitLanded = true;
      return r;
    }
    return 'none';
  }

  destroy() {
    this.g.destroy();
  }
}

// =====================================================================================
//  FORTRESS SENTINEL  (also used, scaled up, as the Sanctum Elite)
// =====================================================================================
export class Sentinel extends Enemy {
  private patrol: [number, number];
  private patDir: 1 | -1 = 1;
  private pauseT = 0;
  private runPhase = 0;
  private lostT = 0;
  private alertTimer = 0.45;
  private clankT = Math.random() * 0.4;
  private strikes = 0;
  private readonly style: RigStyle;
  private readonly elite: boolean;

  constructor(scene: Phaser.Scene, w: IWorld, spawn: EnemySpawn) {
    const elite = spawn.type === 'elite';
    super(scene, w, elite ? ENEMIES.elite : ENEMIES.sentinel, spawn);
    this.elite = elite;
    this.style = elite ? ELITE_STYLE : SENTINEL_STYLE;
    this.patrol = spawn.patrol ?? [spawn.x - 120, spawn.x + 120];
    this.patDir = Math.random() < 0.5 ? 1 : -1;
    this.facing = this.patDir;
  }

  private ledgeAhead(dir: 1 | -1): boolean {
    const probeX = dir > 0 ? this.body.x + this.body.w + 10 : this.body.x - 10;
    return groundAt(probeX, this.y + 6, this.w.solids);
  }

  update(dt: number) {
    const p = this.w.player;
    const dxAll = p.cx - this.x;
    this.active = Math.abs(dxAll) < this.activeRange;
    this.g.setVisible(this.active || this.dead);
    if (!this.tickCommon(dt)) {
      // death: ragdoll slump
      this.body.vx = approach(this.body.vx, 0, 500 * dt);
      this.body.vy = Math.min(900, this.body.vy + 1900 * dt);
      moveBody(this.body, this.w.solids, dt);
      return;
    }
    if (!this.active) return;

    const b = this.body;
    const dx = dxAll;
    const adx = Math.abs(dx);
    const dy = p.feetY - this.y;
    const pAlive = !p.dead;
    const inFront = sign(dx) === this.facing;
    const canSee = pAlive && adx < this.def.sight * (this.aggr > 1.1 ? 1.2 : 1) && Math.abs(dy) < 110 && (inFront || adx < 90);
    const speedMul = this.aggr;
    if (Math.abs(b.vx) > 40 && b.onGround && adx < 420) {
      this.clankT -= dt * (Math.abs(b.vx) / 90);
      if (this.clankT <= 0) {
        this.clankT = 0.55;
        audio.sfx('clank', 0.8 + Math.random() * 0.4);
      }
    }

    switch (this.state) {
      case 'PATROL': {
        if (this.pauseT > 0) {
          this.pauseT -= dt;
          b.vx = approach(b.vx, 0, 600 * dt);
        } else {
          b.vx = approach(b.vx, this.patDir * this.def.patrolSpeed, 500 * dt);
          this.facing = this.patDir;
          const atEdge = (this.patDir > 0 && this.x > this.patrol[1]) || (this.patDir < 0 && this.x < this.patrol[0]);
          if (atEdge || b.wall !== 0 || (b.onGround && !this.ledgeAhead(this.patDir))) {
            this.patDir = (-this.patDir) as 1 | -1;
            this.pauseT = 0.9;
          }
        }
        this.runPhase += Math.abs(b.vx) * dt * 0.05;
        if (canSee) {
          this.facing = sign(dx) as 1 | -1;
          this.alertTimer = 0.42 / speedMul;
          audio.sfx('alert');
          this.setState('ALERT');
        }
        break;
      }
      case 'ALERT': {
        b.vx = approach(b.vx, 0, 900 * dt);
        if (pAlive) this.facing = sign(dx) as 1 | -1;
        if (this.stateT >= this.alertTimer) this.setState('CHASE');
        break;
      }
      case 'CHASE': {
        if (!pAlive) {
          this.setState('PATROL');
          break;
        }
        this.facing = sign(dx) === 0 ? this.facing : (sign(dx) as 1 | -1);
        const reach = this.def.reach;
        const inRange = adx < reach * 0.82 && Math.abs(dy) < 70;
        if (inRange && this.attackCd <= 0) {
          this.beginAttack();
          break;
        }
        const standOff = adx < reach * 0.6;
        if (standOff) b.vx = approach(b.vx, 0, 900 * dt);
        else if (b.onGround && !this.ledgeAhead(this.facing) && !(Math.abs(dy) > 60)) b.vx = approach(b.vx, 0, 900 * dt);
        else b.vx = approach(b.vx, this.facing * this.def.chaseSpeed * speedMul, 1100 * dt);
        this.runPhase += Math.abs(b.vx) * dt * 0.05;
        if (adx > this.def.sight * 2 || Math.abs(dy) > 260) this.lostT += dt;
        else this.lostT = 0;
        if (this.lostT > 2.5) {
          this.lostT = 0;
          this.setState('PATROL');
        }
        break;
      }
      case 'ATTACK':
        this.updateAttack(dt, dx);
        break;
      case 'RECOVER': {
        b.vx = approach(b.vx, 0, 1400 * dt);
        this.vulnerable = true;
        if (this.stateT >= this.recoverTime) {
          this.vulnerable = false;
          this.attackCd = 0.4;
          this.setState(canSee || adx < 200 ? 'CHASE' : 'PATROL');
        }
        break;
      }
      case 'HURT': {
        b.vx = approach(b.vx, 0, 700 * dt);
        this.stunT -= dt;
        if (this.stunT <= 0) {
          this.vulnerable = false;
          this.armorT = 0.55;
          this.setState('CHASE');
        }
        break;
      }
    }

    b.vy = Math.min(900, b.vy + 1900 * dt);
    moveBody(b, this.w.solids, dt);
  }

  private recoverTime = 0.75;

  private beginAttack() {
    this.phase = 0;
    this.struck = false;
    this.hitLanded = false;
    this.strikes = 0;
    this.setState('ATTACK');
    audio.sfx('telegraph');
  }

  private updateAttack(dt: number, dx: number) {
    const b = this.body;
    const def = this.def;
    const tele = def.telegraph / this.aggr;
    if (this.phase === 0) {
      b.vx = approach(b.vx, 0, 1200 * dt);
      // track the player during the first 55% of the telegraph, then commit
      if (this.stateT < tele * 0.55 && sign(dx) !== 0) this.facing = sign(dx) as 1 | -1;
      if (this.stateT >= tele) {
        this.phase = 1;
        this.stateT = 0;
        this.struck = false;
        b.vx = this.facing * (this.elite ? 220 : 170);
        audio.sfx('swing', 0.7);
        this.w.fx.slash(this.x, this.y - 34, this.facing, 20, def.reach, 1.5, 1.6, PAL.crimsonHot, 0.18);
      }
    } else if (this.phase === 1) {
      // strike window
      if (!this.struck) {
        const box = frontBox(this.x, this.y, this.facing, def.reach, 56, 4, 4);
        const r = this.strikePlayer(box);
        if (r === 'parried') {
          this.struck = true;
          return;
        }
        if (r !== 'none') this.struck = true;
      }
      b.vx = approach(b.vx, 0, 900 * dt);
      if (this.stateT >= def.strike) {
        this.strikes++;
        if (this.elite && this.strikes < 2) {
          // second swing of the elite combo: short re-telegraph
          this.phase = 0;
          this.stateT = def.telegraph * 0.45;
          this.struck = false;
          this.facing = sign(dx) === 0 ? this.facing : (sign(dx) as 1 | -1);
          audio.sfx('telegraph', 1.3);
          return;
        }
        this.phase = 2;
        // A whiffed attack leaves the sentinel open for longer.
        this.recoverTime = def.recover * (this.hitLanded ? 1 : 1.3);
        this.setState('RECOVER');
        this.phase = 0;
      }
    }
  }

  private pose(): Pose {
    const p = neutralPose();
    const st = this.state;
    const t = this.t;
    const ph = this.runPhase;
    switch (st) {
      case 'PATROL': {
        const amp = Math.min(0.45, Math.abs(this.body.vx) / 110);
        const leg = (a: number): [number, number] => [amp * Math.sin(a), 0.12 + amp * 0.9 * Math.max(0, Math.cos(a))];
        p.legF = leg(ph);
        p.legB = leg(ph + Math.PI);
        p.lean = 0.04;
        p.armF = [0.25, 0.6];
        p.armB = [-0.3 * Math.sin(ph) * amp, 0.4];
        p.weapon = 3.1;
        break;
      }
      case 'ALERT':
        p.lean = -0.08;
        p.legF = [0.3, 0.2];
        p.legB = [-0.3, 0.2];
        p.armF = [0.9, 0.7];
        p.armB = [0.2, 0.6];
        p.weapon = 1.7 + Math.sin(this.stateT * 30) * 0.05;
        break;
      case 'CHASE': {
        const amp = 0.7;
        const leg = (a: number): [number, number] => [amp * Math.sin(a), 0.2 + 0.9 * Math.max(0, Math.cos(a))];
        p.legF = leg(ph);
        p.legB = leg(ph + Math.PI);
        p.lean = 0.28;
        p.armF = [1.0, 0.5];
        p.armB = [-0.6 * Math.sin(ph), 1.0];
        p.weapon = 1.65;
        break;
      }
      case 'ATTACK': {
        const def = this.def;
        const tele = def.telegraph / this.aggr;
        if (this.phase === 0) {
          const k = smooth(Math.min(1, this.stateT / tele));
          p.lean = -0.25 * k;
          p.legF = [0.4, 0.5 + 0.3 * k];
          p.legB = [-0.55, 0.4 + 0.3 * k];
          p.weapon = 1.7 + (3.5 - 1.7) * k;
          p.armF = [p.weapon * 0.8, 0.25];
          p.armB = [-0.6, 0.7];
          if (this.elite) p.crouch = k * 0.6;
        } else {
          p.lean = 0.6;
          p.legF = [0.95, 0.3];
          p.legB = [-0.8, 0.35];
          p.weapon = this.elite ? 0.4 : 1.57;
          p.armF = this.elite ? [1.3, 0.4] : [1.5, 0.05];
          p.armB = [-0.9, 0.5];
        }
        break;
      }
      case 'RECOVER':
        p.lean = 0.5;
        p.legF = [0.7, 0.3];
        p.legB = [-0.5, 0.4];
        p.armF = [0.9, 0.3];
        p.armB = [-0.3, 0.6];
        p.weapon = 1.1;
        break;
      case 'HURT':
        p.lean = -0.5;
        p.head = -0.3;
        p.legF = [0.3, 0.6];
        p.legB = [-0.2, 0.5];
        p.armF = [-1.2, 0.6];
        p.armB = [1.8, 0.5];
        p.weapon = -1.5;
        break;
      case 'DEAD':
        p.lean = -0.3;
        p.legF = [0.5, 1.0];
        p.legB = [0.1, 0.9];
        p.armF = [-1.4, 0.6];
        p.armB = [-1.0, 0.5];
        p.weapon = null;
        break;
    }
    void t;
    return p;
  }

  draw() {
    const g = this.g;
    g.clear();
    if (!this.active && !this.dead) return;
    const alpha = this.dead ? Math.max(0, 1 - Math.max(0, this.fadeT - 0.5) / 0.8) : 1;
    if (alpha <= 0) {
      this.g.setVisible(false);
      return;
    }
    let tilt = 0;
    if (this.dead) tilt = -Math.min(1, this.fadeT * 2.5) * 1.5;
    // Attack telegraph: a danger wedge in front of the sentinel.
    if (this.state === 'ATTACK' && this.phase === 0) {
      const tele = this.def.telegraph / this.aggr;
      const k = Math.min(1, this.stateT / tele);
      const reach = this.def.reach;
      const f = this.facing;
      const cx = this.x;
      const gy = this.y;
      g.fillStyle(PAL.crimsonHot, 0.06 + 0.22 * k);
      g.beginPath();
      g.moveTo(cx, gy - 30);
      g.lineTo(cx + f * reach, gy - 54);
      g.lineTo(cx + f * reach, gy);
      g.closePath();
      g.fillPath();
      g.lineStyle(1.5, PAL.crimsonHot, 0.3 + 0.6 * k);
      g.strokeRect(f > 0 ? cx : cx - reach, gy - 56, reach, 56);
    }
    const eye = this.state === 'ATTACK' || this.state === 'ALERT' ? 1 : this.state === 'CHASE' ? 0.9 : 0.55;
    drawRig(g, this.x, this.y, this.facing, this.pose(), this.style, {
      alpha, tilt, eyeGlow: eye, flash: this.flashT / 0.13, rimAlpha: this.vulnerable ? 0.95 : 0.4,
      rimColor: this.vulnerable ? PAL.amberHot : PAL.stormLight,
    });
    // Alert mark.
    if (this.state === 'ALERT') {
      g.fillStyle(PAL.amberHot, 1);
      const ax = this.x;
      const ay = this.y - 86 - Math.sin(this.stateT * 20) * 2;
      g.fillRect(ax - 1.5, ay, 3, 11);
      g.fillRect(ax - 1.5, ay + 14, 3, 3);
    }
    if (this.state === 'HURT' && this.vulnerable) {
      // dizzy sparks after a parry
      g.lineStyle(2, PAL.amberHot, 0.8);
      g.strokeCircle(this.x, this.y - 78, 6 + Math.sin(this.t * 14) * 1.5);
    }
  }
}

// =====================================================================================
//  SANCTUM WRAITH
// =====================================================================================
type WPhase = 'fade' | 'tele' | 'strike' | 'tele2' | 'strike2';
export class Wraith extends Enemy {
  private zone: { x0: number; x1: number; y0: number; y1: number };
  private target = { x: 0, y: 0 };
  private retarget = 0;
  private cx = 0;
  private cy = 0;
  private alpha = 1;
  private wphase: WPhase = 'fade';
  private blink = { x: 0, y: 0 };
  private seed = Math.random() * 100;
  private r = rng(Math.floor(Math.random() * 1e6));
  private recoverT = 0.85;
  private tendril: Array<{ x: number; y: number }> = [];

  constructor(scene: Phaser.Scene, w: IWorld, spawn: EnemySpawn) {
    super(scene, w, ENEMIES.wraith, spawn);
    this.zone = spawn.zone ?? { x0: spawn.x - 160, x1: spawn.x + 160, y0: spawn.y - 140, y1: spawn.y };
    this.cx = spawn.x;
    this.cy = spawn.y - 40;
    this.target = { x: this.cx, y: this.cy };
    this.attackCd = 1.5 + Math.random();
    for (let i = 0; i < 6; i++) this.tendril.push({ x: this.cx, y: this.cy });
  }

  get x() { return this.cx; }
  get y() { return this.cy + this.def.h / 2; }
  hurtbox(): Rect { return { x: this.cx - this.def.w / 2, y: this.cy - this.def.h / 2, w: this.def.w, h: this.def.h }; }

  private syncBody() {
    this.body.x = this.cx - this.body.w / 2;
    this.body.y = this.cy - this.body.h / 2;
  }

  hurt(info: HitInfo): HitResult {
    if (this.alpha < 0.35 && this.state === 'ATTACK' && this.wphase === 'fade') return 'dodged'; // intangible while blinking
    const r = super.hurt(info);
    if (r === 'hit') {
      this.cx += info.dir * 22;
      this.cy -= info.knockUp > 0 ? 10 : 0;
      this.clampToZone();
    }
    return r;
  }

  private clampToZone() {
    this.cx = clamp(this.cx, this.zone.x0 - 40, this.zone.x1 + 40);
    this.cy = clamp(this.cy, this.zone.y0 - 40, this.zone.y1);
  }

  protected die(info: HitInfo) {
    super.die(info);
    this.w.fx.shadowSmoke(this.cx, this.cy, 10);
    this.w.fx.violet(this.cx, this.cy, 14);
  }

  update(dt: number) {
    const p = this.w.player;
    const dx = p.cx - this.cx;
    this.active = Math.abs(dx) < this.activeRange;
    this.g.setVisible(this.active || this.dead);
    if (!this.tickCommon(dt)) return;
    if (!this.active) return;
    const adx = Math.abs(dx);
    const dy = p.body.y + 26 - this.cy;
    const pAlive = !p.dead;
    const speedMul = this.aggr;
    const bob = Math.sin(this.t * 2.3 + this.seed) * 5;

    switch (this.state) {
      case 'PATROL': {
        this.retarget -= dt;
        if (this.retarget <= 0) {
          this.retarget = 1.2 + this.r() * 1.4;
          this.target = {
            x: this.zone.x0 + this.r() * (this.zone.x1 - this.zone.x0),
            y: this.zone.y0 + this.r() * (this.zone.y1 - this.zone.y0),
          };
        }
        this.moveToward(this.target.x, this.target.y + bob, this.def.patrolSpeed, dt);
        this.alpha = approach(this.alpha, 0.75, dt * 2);
        if (pAlive && adx < this.def.sight && Math.abs(dy) < 200) {
          audio.sfx('wraith');
          this.setState('ALERT');
        }
        break;
      }
      case 'ALERT': {
        this.facing = sign(dx) === 0 ? this.facing : (sign(dx) as 1 | -1);
        this.alpha = approach(this.alpha, 1, dt * 4);
        if (this.stateT > 0.5 / speedMul) this.setState('CHASE');
        break;
      }
      case 'CHASE': {
        if (!pAlive || adx > this.def.sight * 2.2) {
          this.setState('PATROL');
          break;
        }
        this.facing = sign(dx) === 0 ? this.facing : (sign(dx) as 1 | -1);
        this.alpha = approach(this.alpha, 1, dt * 4);
        // Hover at a preferred distance, circling slightly: reacts to the player's range.
        const pref = 150 + Math.sin(this.t * 0.9 + this.seed) * 45;
        const side = adx < pref - 25 ? -1 : adx > pref + 25 ? 1 : 0; // retreat / approach / hold
        const tx = this.cx + sign(dx) * side * 80;
        const ty = p.body.y + 8 + Math.sin(this.t * 1.6 + this.seed) * 40;
        this.moveToward(tx, ty + bob, this.def.chaseSpeed * speedMul, dt);
        if (this.attackCd <= 0 && adx < 430) this.beginAttack(p.cx, p.facing);
        break;
      }
      case 'ATTACK':
        this.updateAttack(dt, dx);
        break;
      case 'RECOVER': {
        this.vulnerable = true;
        this.alpha = approach(this.alpha, 1, dt * 5);
        this.cy += Math.sin(this.t * 6) * 0.2;
        if (this.stateT > this.recoverT) {
          this.vulnerable = false;
          this.attackCd = (1.6 + this.r() * 1.2) / speedMul;
          this.setState('CHASE');
        }
        break;
      }
      case 'HURT': {
        this.stunT -= dt;
        this.alpha = 0.55 + Math.sin(this.t * 40) * 0.3;
        this.cx += this.body.vx * dt * 0.2;
        this.body.vx = approach(this.body.vx, 0, 600 * dt);
        this.clampToZone();
        if (this.stunT <= 0) {
          this.vulnerable = false;
          this.armorT = 0.4;
          this.setState('CHASE');
        }
        break;
      }
    }
    this.syncBody();
    // tendrils (tail) follow
    let px = this.cx - this.facing * 4;
    let py = this.cy + 8;
    for (let i = 0; i < this.tendril.length; i++) {
      const tn = this.tendril[i];
      tn.x += (px - this.facing * 5 - tn.x) * Math.min(1, dt * 9);
      tn.y += (py + 7 + Math.sin(this.t * 5 + i) * 1.5 - tn.y) * Math.min(1, dt * 9);
      px = tn.x;
      py = tn.y;
    }
  }

  private moveToward(tx: number, ty: number, speed: number, dt: number) {
    const dx = tx - this.cx;
    const dy = ty - this.cy;
    const d = Math.hypot(dx, dy);
    if (d < 2) return;
    const s = Math.min(d, speed * dt);
    this.cx += (dx / d) * s;
    this.cy += (dy / d) * s;
    this.clampToZone();
  }

  private beginAttack(px: number, pFacing: 1 | -1) {
    this.setState('ATTACK');
    this.wphase = 'fade';
    this.struck = false;
    this.hitLanded = false;
    // Blink to the side the player is NOT facing if the zone allows, otherwise in front.
    const behind = -pFacing;
    let bx = px + behind * 80;
    if (bx < this.zone.x0 - 30 || bx > this.zone.x1 + 30) bx = px - behind * 80;
    this.blink = { x: clamp(bx, this.zone.x0 - 30, this.zone.x1 + 30), y: clamp(this.w.player.body.y + 14, this.zone.y0 - 30, this.zone.y1) };
    audio.sfx('wraith');
  }

  private updateAttack(dt: number, dx: number) {
    const def = this.def;
    const tele = def.telegraph / this.aggr;
    switch (this.wphase) {
      case 'fade': {
        this.alpha = approach(this.alpha, 0, dt * 6);
        if (this.alpha <= 0.01) {
          this.cx = this.blink.x;
          this.cy = this.blink.y;
          this.facing = sign(this.w.player.cx - this.cx) === 0 ? this.facing : (sign(this.w.player.cx - this.cx) as 1 | -1);
          this.wphase = 'tele';
          this.stateT = 0;
          this.w.fx.shadowSmoke(this.cx, this.cy, 5);
          audio.sfx('telegraph', 1.4);
        }
        break;
      }
      case 'tele':
      case 'tele2': {
        this.alpha = approach(this.alpha, 1, dt * 7);
        const total = this.wphase === 'tele' ? tele : tele * 0.5;
        if (this.stateT < total * 0.6) this.facing = sign(this.w.player.cx - this.cx) === 0 ? this.facing : (sign(this.w.player.cx - this.cx) as 1 | -1);
        if (this.stateT >= total) {
          this.wphase = this.wphase === 'tele' ? 'strike' : 'strike2';
          this.stateT = 0;
          this.struck = false;
          audio.sfx('swing', 0.6);
          this.w.fx.slash(this.cx, this.cy, this.facing, 8, def.reach, 1.0, 2.2, PAL.crimsonHot, 0.2);
        }
        break;
      }
      case 'strike':
      case 'strike2': {
        this.cx += this.facing * 140 * dt;
        if (!this.struck) {
          const box = { x: this.facing > 0 ? this.cx - 6 : this.cx - def.reach + 6, y: this.cy - 30, w: def.reach, h: 62 };
          const r = this.strikePlayer(box);
          if (r === 'parried') {
            this.struck = true;
            return;
          }
          if (r !== 'none') this.struck = true;
        }
        if (this.stateT >= def.strike) {
          if (this.wphase === 'strike' && this.aggr >= 1.2 && !this.hitLanded) {
            // At high Shadow Debt the wraith follows up with a fast second swipe.
            this.wphase = 'tele2';
            this.stateT = 0;
            this.struck = false;
          } else {
            this.recoverT = def.recover * (this.hitLanded ? 1 : 1.25);
            this.setState('RECOVER');
          }
        }
        break;
      }
    }
    void dx;
  }

  draw() {
    const g = this.g;
    g.clear();
    if (!this.active && !this.dead) return;
    let a = this.dead ? Math.max(0, 1 - this.fadeT * 1.6) : this.alpha;
    if (a <= 0.01) {
      if (this.dead && this.fadeT > 1) this.g.setVisible(false);
      return;
    }
    const x = this.cx;
    const y = this.cy;
    const f = this.facing;
    const t = this.t;
    const attackingTele = this.state === 'ATTACK' && (this.wphase === 'tele' || this.wphase === 'tele2');
    const k = attackingTele ? Math.min(1, this.stateT / (this.def.telegraph / this.aggr)) : 0;

    // Telegraph: expanding crimson ring + claw reach.
    if (attackingTele) {
      g.lineStyle(2, PAL.crimsonHot, 0.25 + 0.6 * k);
      g.strokeCircle(x + f * 24, y, 12 + (1 - k) * 34);
      g.fillStyle(PAL.crimsonHot, 0.05 + 0.15 * k);
      g.fillRect(f > 0 ? x : x - this.def.reach, y - 30, this.def.reach, 62);
    }

    // Outer aura (rim) and body.
    const body = (ox: number, oy: number, col: number, al: number) => {
      g.fillStyle(col, al);
      g.beginPath();
      // hooded head
      g.moveTo(x + ox + f * 8, y - 20 + oy);
      g.lineTo(x + ox + f * 2, y - 30 + oy);
      g.lineTo(x + ox - f * 9, y - 18 + oy);
      // ragged cloak hem with wavy bottom
      const hem = 8;
      for (let i = 0; i <= hem; i++) {
        const u = i / hem;
        const hx = x + ox - f * (12 - u * 22);
        const hy = y + 24 + oy + Math.sin(t * 6 + i * 1.7) * 4 + (i % 2) * 6;
        g.lineTo(hx, hy);
      }
      g.lineTo(x + ox + f * 12, y - 4 + oy);
      g.closePath();
      g.fillPath();
      // arms / claws
      const reachK = attackingTele ? 1 : this.state === 'ATTACK' ? 1.4 : 0.35;
      g.lineStyle(3.2, col, al);
      g.beginPath();
      g.moveTo(x + ox + f * 4, y - 8 + oy);
      g.lineTo(x + ox + f * (14 + 12 * reachK), y - 12 + oy - (attackingTele ? 14 * k : 0));
      g.strokePath();
      g.lineStyle(2, col, al);
      for (let c = -1; c <= 1; c++) {
        g.beginPath();
        g.moveTo(x + ox + f * (14 + 12 * reachK), y - 12 + oy - (attackingTele ? 14 * k : 0));
        g.lineTo(x + ox + f * (22 + 14 * reachK), y - 12 + oy + c * 4 - (attackingTele ? 14 * k : 0));
        g.strokePath();
      }
    };
    body(-1.5 * f, -1, PAL.shadow, 0.35 * a);
    body(0, 0, PAL.obsidian, a);
    // tendril tail
    for (let i = 1; i < this.tendril.length; i++) {
      g.lineStyle(Math.max(1, 5 - i * 0.7), PAL.obsidian, a * 0.9);
      g.beginPath();
      g.moveTo(this.tendril[i - 1].x, this.tendril[i - 1].y + 20);
      g.lineTo(this.tendril[i].x, this.tendril[i].y + 20);
      g.strokePath();
    }
    // eyes
    const eyeCol = this.state === 'ATTACK' || this.state === 'ALERT' ? PAL.crimsonHot : PAL.crimson;
    g.fillStyle(eyeCol, a);
    g.fillRect(x + f * 1 - 1, y - 22, 3.4, 2);
    g.fillRect(x + f * 6 - 1, y - 21, 3.4, 2);
    if (this.flashT > 0) {
      g.fillStyle(PAL.white, (this.flashT / 0.13) * 0.8);
      g.fillCircle(x, y, 18);
    }
    if (this.vulnerable) {
      g.lineStyle(1.5, PAL.amberHot, 0.7);
      g.strokeCircle(x, y - 4, 22 + Math.sin(t * 10) * 1.5);
    }
    if (this.state === 'ALERT') {
      g.fillStyle(PAL.crimsonHot, 1);
      g.fillRect(x - 1.5, y - 62, 3, 11);
      g.fillRect(x - 1.5, y - 48, 3, 3);
    }
  }
}

export function createEnemy(scene: Phaser.Scene, w: IWorld, s: EnemySpawn): Enemy {
  return s.type === 'wraith' ? new Wraith(scene, w, s) : new Sentinel(scene, w, s);
}
