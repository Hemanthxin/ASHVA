import Phaser from 'phaser';
import { PAL, PHYS } from '../config/gameConfig';
import { input } from '../systems/InputSystem';
import { audio } from '../systems/AudioSystem';
import { Body, makeBody, moveBody, rectBlocked, wallProbe } from '../systems/MovementSystem';
import { Damageable, HitInfo, HitResult, frontBox, hitInfo } from '../systems/CombatSystem';
import { SHADOW_DASH } from '../systems/ShadowDebtSystem';
import { BLADE, COMBO, AttackDef } from '../data/weapons';
import { ARU_STYLE, Cloth, Pose, drawRig, jointWorld, neutralPose } from '../render/Silhouette';
import type { IWorld, Hittable } from './World';
import { Rect, approach, clamp, overlap, sign, smooth } from '../utils/math';

export type PState =
  | 'IDLE' | 'RUN' | 'SPRINT' | 'JUMP' | 'FALL' | 'LAND' | 'SLIDE' | 'VAULT' | 'WALL' | 'WALL_JUMP'
  | 'ATTACK' | 'DODGE' | 'BLOCK' | 'SHADOW' | 'HURT' | 'DEAD';

export interface Abilities { blade: boolean; shadowDash: boolean; wallJump: boolean }

interface Ghost { x: number; y: number; facing: 1 | -1; pose: Pose; life: number }

const PARRY_WINDOW = 0.2;

export class Player implements Damageable {
  readonly g: Phaser.GameObjects.Graphics;
  body: Body;
  facing: 1 | -1 = 1;
  state: PState = 'IDLE';
  stateT = 0;
  hp: number;
  maxHp: number;
  invuln = 0;
  dead = false;
  abilities: Abilities;

  // timers / flags
  private t = 0;
  private coyote = 0;
  private wallLock = 0;
  private slideCd = 0;
  private dodgeCd = 0;
  private shadowCd = 0;
  private blockT = 0;
  private landT = 0;
  private jumping = false;
  private airDodged = false;
  private crouched = false;
  private runPhase = 0;
  private vaultT = 0;
  private wallDir: -1 | 0 | 1 = 0;
  private wallCoyote = 0;
  private comboIdx = 0;
  private comboTimer = 0;
  private atk: AttackDef | null = null;
  private atkHit = new Set<Hittable>();
  private atkFired = false;
  private atkAir = false;
  private dodgeDir: 1 | -1 = 1;
  private shadowHit = new Set<Hittable>();
  private deathT = 0;
  private deathNotified = false;
  private lastVy = 0;
  private hurtT = 0;
  private safeT = 0;
  private auraT = 0;
  private stepT = 0;
  private flashT = 0;
  lastSafe: { x: number; y: number };
  private cloth = new Cloth(9, 5.2);
  private ghosts: Ghost[] = [];
  private readonly style = ARU_STYLE;
  /** Set by the level when standing in an interaction zone, to suppress attack-on-interact clashes. */
  stats = { hits: 0, parries: 0, kills: 0, damageTaken: 0 };

  constructor(private scene: Phaser.Scene, x: number, feetY: number, hp: number, maxHp: number, abilities: Abilities) {
    this.body = makeBody(x - PHYS.playerW / 2, feetY - PHYS.playerH, PHYS.playerW, PHYS.playerH);
    this.hp = hp;
    this.maxHp = maxHp;
    this.abilities = { ...abilities };
    this.g = scene.add.graphics().setDepth(10);
    this.lastSafe = { x, y: feetY };
    this.cloth.reset(x, feetY - 40);
  }

  get cx() { return this.body.x + this.body.w / 2; }
  get feetY() { return this.body.y + this.body.h; }
  hurtbox(): Rect { return { x: this.body.x + 1, y: this.body.y + 2, w: this.body.w - 2, h: this.body.h - 2 }; }
  get attacking() { return this.state === 'ATTACK'; }
  get isGrounded() { return this.body.onGround; }

  private setState(s: PState) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
  }

  private setCrouch(on: boolean, w: IWorld): boolean {
    if (on === this.crouched) return true;
    const b = this.body;
    if (on) {
      b.y += PHYS.playerH - PHYS.slideH;
      b.h = PHYS.slideH;
      this.crouched = true;
      return true;
    }
    // Stand only when there is headroom.
    const test = { x: b.x + 1, y: b.y + b.h - PHYS.playerH, w: b.w - 2, h: PHYS.playerH - 1 };
    if (rectBlocked(test, w.solids)) return false;
    b.y -= PHYS.playerH - PHYS.slideH;
    b.h = PHYS.playerH;
    this.crouched = false;
    return true;
  }

  // ------------------------------------------------------------------ update
  update(dt: number, w: IWorld) {
    this.t += dt;
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    this.slideCd = Math.max(0, this.slideCd - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.shadowCd = Math.max(0, this.shadowCd - dt);
    this.wallLock = Math.max(0, this.wallLock - dt);
    this.wallCoyote = Math.max(0, this.wallCoyote - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0 && this.state !== 'ATTACK') this.comboIdx = 0;
    this.body.dropThrough = Math.max(0, this.body.dropThrough - dt);
    this.ghosts.forEach((gh) => (gh.life -= dt));
    this.ghosts = this.ghosts.filter((gh) => gh.life > 0);

    if (this.state === 'DEAD') {
      this.updateDead(dt, w);
      return;
    }

    const b = this.body;
    const mx = input.moveX;
    const ax = Math.abs(mx);
    const touch = input.lastDevice === 'touch';
    const dirX = ax > 0.15 ? sign(mx) : 0;
    const sprinting = input.isDown('sprint') || (touch && ax > 0.82);
    const mag = touch && !sprinting ? clamp(0.6 + ax * 0.4, 0.6, 0.95) : 1;
    const wantDown = input.isDown('down');
    const wasGround = b.onGround;
    this.lastVy = b.vy;

    if (b.onGround) {
      this.coyote = PHYS.coyote;
      this.airDodged = false;
    } else this.coyote = Math.max(0, this.coyote - dt);

    let gravityMul = 1;

    switch (this.state) {
      case 'IDLE':
      case 'RUN':
      case 'SPRINT':
      case 'LAND': {
        if (!b.onGround) {
          // Walked off a ledge.
          this.setState('FALL');
          break;
        }
        // crouch / slide
        if (wantDown) {
          if (!this.crouched && Math.abs(b.vx) > 170 && this.slideCd <= 0) {
            this.startSlide(w);
            break;
          }
          this.setCrouch(true, w);
        } else if (this.crouched) this.setCrouch(false, w);

        const maxSpd = (sprinting && !this.crouched ? PHYS.sprintSpeed : PHYS.walkSpeed) * (this.crouched ? 0.4 : 1) * mag * (this.state === 'LAND' ? 0.4 : 1);
        const target = dirX * maxSpd;
        const accel = dirX !== 0 && sign(b.vx) !== -dirX ? PHYS.groundAccel : PHYS.groundDecel;
        b.vx = approach(b.vx, target, accel * dt);
        if (dirX !== 0) this.facing = dirX as 1 | -1;

        this.runPhase += Math.abs(b.vx) * dt * 0.052;
        const speed = Math.abs(b.vx);
        if (this.state !== 'LAND') this.setState(speed < 12 ? 'IDLE' : speed > PHYS.walkSpeed + 40 ? 'SPRINT' : 'RUN');
        else if (this.stateT > 0.1) this.setState('IDLE');

        // footsteps + dust
        if (speed > 60) {
          this.stepT -= dt * (speed / 200);
          if (this.stepT <= 0) {
            this.stepT = 0.28;
            audio.sfx('step', 0.8 + Math.random() * 0.4);
            if (speed > 250) w.fx.dust(this.cx - this.facing * 6, this.feetY - 1, 1);
          }
        }

        if (this.tryActions(w, dirX, sprinting)) break;
        break;
      }

      case 'JUMP':
      case 'FALL':
      case 'WALL_JUMP': {
        const airAccel = dirX !== 0 && sign(b.vx) !== -dirX ? PHYS.airAccel : PHYS.airDecel;
        if (this.wallLock <= 0) {
          const maxSpd = (sprinting ? PHYS.sprintSpeed : PHYS.walkSpeed) * mag;
          if (dirX !== 0) {
            // allow momentum above max to bleed off slowly
            const target = dirX * Math.max(maxSpd, Math.abs(b.vx) > maxSpd && sign(b.vx) === dirX ? Math.abs(b.vx) - 1 : 0);
            b.vx = approach(b.vx, target, airAccel * dt);
            this.facing = dirX as 1 | -1;
          } else b.vx = approach(b.vx, 0, PHYS.airDecel * dt);
        }
        // variable jump height
        if (this.jumping && !input.isDown('jump') && b.vy < -180) {
          b.vy *= PHYS.jumpCut;
          this.jumping = false;
        }
        if (b.vy > 0) {
          this.jumping = false;
          if (this.state === 'JUMP' || this.state === 'WALL_JUMP') this.setState('FALL');
        }
        // coyote jump
        if (this.state === 'FALL' && this.coyote > 0 && input.consume('jump', 120)) {
          this.doJump(w);
          break;
        }
        // wall jump shortly after leaving a wall
        if (this.abilities.wallJump && this.wallCoyote > 0 && this.wallDir !== 0 && input.consume('jump', 120)) {
          this.doWallJump(w, this.wallDir as 1 | -1);
          break;
        }
        // wall slide
        if (this.abilities.wallJump && b.vy > -120 && dirX !== 0) {
          const s = wallProbe(b, dirX as 1 | -1, w.solids, 3);
          if (s) {
            this.wallDir = dirX as 1 | -1;
            this.facing = this.wallDir;
            this.setState('WALL');
            break;
          }
        }
        if (this.tryActions(w, dirX, sprinting)) break;
        break;
      }

      case 'WALL': {
        gravityMul = 1;
        const dir = this.wallDir;
        const touching = dir !== 0 && wallProbe(b, dir as 1 | -1, w.solids, 3);
        if (b.onGround) {
          this.setState('IDLE');
          break;
        }
        this.wallCoyote = 0.12;
        if (input.consume('jump', 150)) {
          this.doWallJump(w, dir as 1 | -1);
          break;
        }
        if (!touching || dirX === -dir) {
          this.setState('FALL');
          break;
        }
        b.vx = dir * 20; // keep pressed against the wall
        if (b.vy > PHYS.wallSlideSpeed) b.vy = PHYS.wallSlideSpeed;
        if (Math.random() < 0.25) w.fx.dust(this.cx + dir * 8, this.body.y + 10, 1);
        if (input.consume('dodge') && !this.airDodged) {
          this.startDodge(w, (-dir) as 1 | -1);
        }
        break;
      }

      case 'SLIDE': {
        const k = this.stateT / PHYS.slideTime;
        const spd = PHYS.slideSpeed * (1 - smooth(Math.min(1, k)) * 0.72);
        b.vx = this.facing * spd;
        if (Math.random() < 0.5) w.fx.dust(this.cx - this.facing * 10, this.feetY - 2, 1);
        if (!b.onGround) {
          this.setState('FALL');
          break;
        }
        const done = this.stateT >= PHYS.slideTime || b.wall !== 0;
        if (input.consume('jump', 120) && this.setCrouch(false, w)) {
          this.doJump(w);
          b.vx = this.facing * Math.max(Math.abs(b.vx), PHYS.sprintSpeed);
          break;
        }
        if (done) {
          // Keep sliding under low ceilings until there is room to stand.
          if (wantDown || !this.setCrouch(false, w)) {
            if (this.stateT > PHYS.slideTime + 0.01) {
              this.setState('IDLE');
              b.vx = this.facing * 90;
            }
          } else {
            this.slideCd = PHYS.slideCooldown;
            this.setState('RUN');
          }
        }
        if (input.consume('dodge')) {
          if (this.setCrouch(false, w)) this.startDodge(w, this.facing);
        }
        break;
      }

      case 'VAULT': {
        this.vaultT += dt;
        const dir = this.facing;
        b.vx = dir * Math.max(240, Math.abs(b.vx));
        const ig = b.ignore;
        if (ig && (b.x > ig.x + ig.w + 2 || b.x + b.w < ig.x - 2) && this.vaultT > 0.1) b.ignore = null;
        if ((b.onGround && this.vaultT > 0.12) || this.vaultT > 0.8) {
          b.ignore = null;
          this.setState(b.onGround ? 'RUN' : 'FALL');
        }
        break;
      }

      case 'ATTACK':
        gravityMul = this.atkAir && this.stateT < 0.35 ? 0.35 : 1;
        this.updateAttack(dt, w, dirX);
        break;

      case 'DODGE': {
        const dur = PHYS.dodgeTime;
        b.vx = this.dodgeDir * PHYS.dodgeSpeed * (1 - 0.35 * (this.stateT / dur));
        gravityMul = 0.25;
        if (Math.random() < 0.6) w.fx.dust(this.cx - this.dodgeDir * 8, this.feetY - 4, 1);
        if (this.stateT >= dur) {
          b.vx *= 0.45;
          this.setState(b.onGround ? 'IDLE' : 'FALL');
          this.dodgeCd = PHYS.dodgeCooldown;
        }
        break;
      }

      case 'BLOCK': {
        this.blockT += dt;
        b.vx = approach(b.vx, 0, 2400 * dt);
        if (!input.isDown('block') && this.blockT > 0.08) this.setState('IDLE');
        else if (!b.onGround) this.setState('FALL');
        else if (input.consume('dodge')) this.startDodge(w, this.facing);
        break;
      }

      case 'SHADOW': {
        gravityMul = 0;
        b.vy = 0;
        b.vx = this.facing * 880;
        if (this.stateT > 0.06 && Math.floor(this.stateT * 60) % 2 === 0) this.pushGhost(0.3);
        w.fx.shadowSmoke(this.cx, this.body.y + this.body.h / 2, 1);
        this.shadowStrike(w);
        if (this.stateT >= 0.2 || b.wall !== 0) {
          b.vx = this.facing * 160;
          this.setState(b.onGround ? 'IDLE' : 'FALL');
          this.invuln = Math.max(this.invuln, 0.15);
        }
        break;
      }

      case 'HURT': {
        this.hurtT -= dt;
        b.vx = approach(b.vx, 0, 900 * dt);
        if (this.hurtT <= 0) this.setState(b.onGround ? 'IDLE' : 'FALL');
        break;
      }
    }

    // Gravity and integration.
    if (this.state !== 'SHADOW') {
      b.vy = Math.min(PHYS.maxFall, b.vy + PHYS.gravity * gravityMul * dt);
    }
    moveBody(b, w.solids, dt);

    // Post-move bookkeeping.
    if (b.onGround && !wasGround) this.onLanded(w);
    if (b.hitCeil) this.jumping = false;
    if (this.state !== 'VAULT' && b.ignore) b.ignore = null;

    // Auto-vault: running into a low obstacle on the ground.
    if ((this.state === 'RUN' || this.state === 'SPRINT') && b.onGround && b.wall !== 0 && dirX === b.wall && !this.crouched) {
      this.tryVault(w);
    }
    // Drop through one-way platforms.
    if (this.state !== 'ATTACK' && b.onGround && wantDown && input.consume('jump', 100) && b.groundSolid?.kind === 'oneway') {
      b.dropThrough = 0.25;
      b.y += 2;
      b.onGround = false;
    }

    // Record the last safe standing position (for pit respawns).
    if (b.onGround && b.groundSolid && b.groundSolid.kind !== 'crumble' && b.groundSolid.kind !== 'moving') {
      this.safeT += dt;
      const gs = b.groundSolid;
      if (this.safeT > 0.3 && this.cx > gs.x + 16 && this.cx < gs.x + gs.w - 16) this.lastSafe = { x: this.cx, y: this.feetY };
    } else this.safeT = 0;

    // Shadow Debt aura.
    this.auraT -= dt;
    const stage = w.debt.stage;
    if (stage >= 1 && this.auraT <= 0) {
      this.auraT = stage === 1 ? 0.35 : stage === 2 ? 0.2 : 0.1;
      w.fx.shadowSmoke(this.cx + (Math.random() - 0.5) * 14, this.body.y + 10 + Math.random() * 30, 1);
    }

    // Scarf.
    const neck = jointWorld('neck', this.pose(w), this.style, this.cx, this.feetY, this.facing);
    this.cloth.update(neck.x, neck.y, -this.facing, dt, this.t);
  }

  // ----------------------------------------------------------------- actions
  /** Shared action intake for grounded and airborne states. Returns true when the state changed. */
  private tryActions(w: IWorld, dirX: number, sprinting: boolean): boolean {
    const b = this.body;
    const grounded = b.onGround;
    // Jump.
    if (grounded && input.consume('jump', PHYS.jumpBuffer * 1000)) {
      if (!this.crouched || this.setCrouch(false, w)) {
        this.doJump(w);
        return true;
      }
    }
    // Dodge.
    if (input.buffered('dodge', 120) && this.dodgeCd <= 0 && (grounded || !this.airDodged)) {
      input.consume('dodge');
      if (this.crouched && !this.setCrouch(false, w)) return false;
      this.startDodge(w, dirX !== 0 ? (dirX as 1 | -1) : this.facing);
      return true;
    }
    // Shadow ability.
    if (input.buffered('shadow', 120)) {
      input.consume('shadow');
      if (this.tryShadow(w)) return true;
    }
    // Attacks.
    if (this.abilities.blade) {
      if (input.consume('light', 140)) {
        if (this.startAttack(w, 'light', dirX)) return true;
      } else if (input.consume('heavy', 140)) {
        if (this.startAttack(w, 'heavy', dirX)) return true;
      }
    } else if (input.consume('light') || input.consume('heavy')) {
      w.toast('You carry no weapon yet.', 1.4);
    }
    // Block.
    if (grounded && input.isDown('block') && this.abilities.blade) {
      if (this.crouched) this.setCrouch(false, w);
      this.blockT = 0;
      this.setState('BLOCK');
      audio.sfx('ui', 1.6);
      return true;
    }
    void sprinting;
    return false;
  }

  private doWallJump(w: IWorld, dir: 1 | -1) {
    const b = this.body;
    b.vx = -dir * PHYS.wallJumpVx;
    b.vy = -PHYS.wallJumpVy;
    this.facing = (-dir) as 1 | -1;
    this.wallLock = PHYS.wallJumpLock;
    this.wallCoyote = 0;
    this.jumping = true;
    this.setState('WALL_JUMP');
    audio.sfx('jump');
    audio.sfx('wallhit');
    w.fx.dust(this.cx + dir * 8, this.body.y + 20, 4);
    input.flush('jump');
  }

  private doJump(w: IWorld) {
    const b = this.body;
    b.vy = -PHYS.jumpVel;
    this.jumping = true;
    this.coyote = 0;
    this.setState('JUMP');
    audio.sfx('jump');
    w.fx.dust(this.cx, this.feetY - 1, 3);
    input.flush('jump');
  }

  private startSlide(w: IWorld) {
    this.setCrouch(true, w);
    this.facing = (sign(this.body.vx) || this.facing) as 1 | -1;
    this.setState('SLIDE');
    this.body.vx = this.facing * PHYS.slideSpeed;
    audio.sfx('slide');
    w.fx.dust(this.cx, this.feetY - 1, 4);
  }

  private tryVault(w: IWorld): boolean {
    const b = this.body;
    const s = b.wallSolid;
    if (!s || s.kind === 'oneway') return false;
    const feet = this.feetY;
    const h = feet - s.y;
    if (h < 10 || h > 66 || s.w > 150) return false;
    const test = { x: s.x - 2, y: s.y - PHYS.playerH - 6, w: s.w + 4, h: PHYS.playerH };
    for (const o of w.solids) {
      if (o === s || !o.active || o.kind === 'oneway') continue;
      if (overlap(test, o)) return false;
    }
    b.ignore = s;
    b.vy = -Math.sqrt(2 * PHYS.gravity * (h + 18));
    b.vx = b.wall * Math.max(250, Math.abs(b.vx));
    this.facing = b.wall as 1 | -1;
    this.vaultT = 0;
    this.setState('VAULT');
    audio.sfx('jump', 1.2);
    w.fx.dust(this.cx, feet - 2, 4);
    return true;
  }

  private startDodge(w: IWorld, dir: 1 | -1) {
    this.dodgeDir = dir;
    this.facing = dir;
    if (!this.body.onGround) this.airDodged = true;
    this.invuln = Math.max(this.invuln, 0.2);
    this.setState('DODGE');
    audio.sfx('dodge');
    w.fx.dust(this.cx, this.feetY - 2, 4);
  }

  private tryShadow(w: IWorld): boolean {
    if (!this.abilities.shadowDash) {
      w.toast('The relic has not bound to your shadow yet.', 1.8);
      return false;
    }
    if (this.shadowCd > 0) return false;
    if (!w.debt.canUse(SHADOW_DASH)) {
      w.toast('The shadow refuses. Pay the debt at a lamp of rest.', 2.2);
      audio.sfx('block');
      this.shadowCd = 0.5;
      return false;
    }
    w.debt.use(SHADOW_DASH);
    this.shadowCd = SHADOW_DASH.cooldown;
    this.shadowHit.clear();
    this.invuln = Math.max(this.invuln, 0.3);
    if (this.crouched) this.setCrouch(false, w);
    this.setState('SHADOW');
    audio.sfx('shadow');
    w.fx.ring(this.cx, this.body.y + 26, PAL.shadow, 1.3, 0.4);
    w.fx.violet(this.cx, this.body.y + 26, 14);
    w.fx.shake(2.5, 0.12);
    w.atmos.flash(0.18);
    this.pushGhost(0.35);
    return true;
  }

  private shadowStrike(w: IWorld) {
    const box = { x: this.body.x - 12, y: this.body.y, w: this.body.w + 24, h: this.body.h };
    const mul = w.debt.powerOf(SHADOW_DASH);
    for (const e of w.hittables) {
      if (e.dead || this.shadowHit.has(e)) continue;
      if (!overlap(box, e.hurtbox())) continue;
      this.shadowHit.add(e);
      const res = e.hurt(hitInfo({
        damage: Math.round(20 * mul), dir: this.facing, knock: 260, knockUp: 120, stun: 0.6, heavy: true, source: 'player',
        ox: e.x, oy: e.y - 30, shadow: true, attacker: this,
      }));
      this.afterHit(w, res, e, true, 20);
    }
  }

  // ------------------------------------------------------------------ attack
  private startAttack(w: IWorld, kind: 'light' | 'heavy', dirX: number): boolean {
    const b = this.body;
    if (this.crouched && !this.setCrouch(false, w)) return false;
    let def: AttackDef;
    if (kind === 'heavy') {
      def = BLADE.heavy;
      this.comboIdx = 0;
    } else {
      def = BLADE[COMBO[this.comboIdx % COMBO.length]];
    }
    this.atk = def;
    this.atkHit.clear();
    this.atkFired = false;
    this.atkAir = !b.onGround;
    if (dirX !== 0) this.facing = dirX as 1 | -1;
    else {
      // Gentle aim assist toward a close enemy.
      let best: Hittable | null = null;
      let bd = 80;
      for (const e of w.hittables) {
        if (e.dead) continue;
        const d = Math.abs(e.x - this.cx);
        if (d < bd && Math.abs(e.y - this.feetY) < 80) {
          bd = d;
          best = e;
        }
      }
      if (best) this.facing = best.x >= this.cx ? 1 : -1;
    }
    this.setState('ATTACK');
    this.stateT = 0;
    input.flush('light');
    input.flush('heavy');
    return true;
  }

  private updateAttack(dt: number, w: IWorld, dirX: number) {
    const def = this.atk!;
    const b = this.body;
    const t = this.stateT;
    const activeStart = def.windup;
    const activeEnd = def.windup + def.active;
    // Active window begins: lunge, sound and trail, exactly once.
    if (!this.atkFired && t >= activeStart) {
      this.atkFired = true;
      audio.sfx(def.sfx, 0.9 + this.comboIdx * 0.1);
      if (b.onGround) b.vx = this.facing * def.lunge;
      else b.vx = this.facing * Math.max(Math.abs(b.vx) * 0.5, def.lunge * 0.7);
      const hip = jointWorld('shoulder', this.pose(w), this.style, this.cx, this.feetY, this.facing);
      w.fx.slash(hip.x, hip.y, this.facing, 14, def.reach + 10, def.from, def.to, this.comboIdx === 2 || def.heavy ? PAL.amberHot : 0xdfeaff, 0.2);
      if (def.shake) w.fx.shake(def.shake * 0.6, 0.1);
      w.fx.dust(this.cx + this.facing * 10, this.feetY - 1, 2);
    }
    if (t >= activeStart && t <= activeEnd) this.strike(w, def);
    // Friction between swings.
    if (t > activeEnd && b.onGround) b.vx = approach(b.vx, 0, 1800 * dt);
    else if (t < activeStart && b.onGround) b.vx = approach(b.vx, 0, 1400 * dt);

    // Chain into the next light attack / heavy finisher as soon as the swing has landed.
    const canChain = t >= activeEnd + 0.03;
    if (canChain && def.id !== 'light3' && def.id !== 'heavy') {
      if (input.consume('light', 160)) {
        this.comboIdx = (this.comboIdx + 1) % COMBO.length;
        this.startAttack(w, 'light', dirX);
        return;
      }
      if (input.consume('heavy', 160)) {
        this.startAttack(w, 'heavy', dirX);
        return;
      }
    }
    // Dodge cancels recovery.
    if (t >= activeEnd && input.buffered('dodge', 100) && this.dodgeCd <= 0) {
      input.consume('dodge');
      this.startDodge(w, dirX !== 0 ? (dirX as 1 | -1) : this.facing);
      return;
    }
    if (t >= activeEnd + 0.06 && b.onGround && input.consume('jump', 100)) {
      this.doJump(w);
      return;
    }
    if (t >= def.windup + def.active + def.recover) {
      if (def.id === 'light3' || def.id === 'heavy') this.comboIdx = 0;
      else {
        this.comboIdx = (this.comboIdx + 1) % COMBO.length;
        this.comboTimer = def.link;
      }
      this.atk = null;
      this.setState(b.onGround ? 'IDLE' : 'FALL');
    }
  }

  private strike(w: IWorld, def: AttackDef) {
    const box = frontBox(this.cx, this.feetY, this.facing, def.reach, def.height, def.offsetY);
    for (const e of w.hittables) {
      if (e.dead || this.atkHit.has(e)) continue;
      if (!overlap(box, e.hurtbox())) continue;
      this.atkHit.add(e);
      const res = e.hurt(hitInfo({
        damage: def.damage, dir: this.facing, knock: def.knock, knockUp: def.knockUp, stun: def.stun, heavy: def.heavy,
        source: 'player', ox: box.x + (this.facing > 0 ? box.w : 0), oy: box.y + box.h * 0.5, attacker: this,
      }));
      this.afterHit(w, res, e, def.heavy, def.damage);
      if (res !== 'none' && res !== 'dodged') {
        // brief forward push-back for readable spacing
        if (this.body.onGround) this.body.vx -= this.facing * 40;
      }
    }
  }

  private afterHit(w: IWorld, res: HitResult, e: Hittable, heavy: boolean, dmg: number) {
    const fx = w.fx;
    if (res === 'hit' || res === 'killed') {
      this.stats.hits++;
      const ox = e.x - this.facing * 8;
      const oy = e.y - 30;
      fx.spark(ox, oy, this.facing, heavy ? 14 : 8);
      fx.ring(ox, oy, 0xffe6b0, heavy ? 0.9 : 0.5, 0.25);
      audio.sfx(heavy ? 'hitHeavy' : 'hit', 0.9 + Math.random() * 0.3);
      fx.freeze(heavy || res === 'killed' ? 90 : 55);
      fx.shake(heavy ? 5 : 2.5, heavy ? 0.18 : 0.1);
      if (res === 'killed') {
        this.stats.kills++;
        w.onEnemyKilled(e);
      }
    } else if (res === 'blocked' || res === 'parried') {
      audio.sfx('block');
      fx.spark(e.x - this.facing * 8, e.y - 36, this.facing, 5);
    }
    void dmg;
  }

  // ----------------------------------------------------------------- damage
  hurt(info: HitInfo): HitResult {
    const w = this.world!;
    if (this.dead || this.state === 'DEAD') return 'none';
    if (this.invuln > 0 || this.state === 'DODGE' || this.state === 'SHADOW') {
      if (this.state === 'DODGE' && this.stateT < 0.2) {
        // perfect-dodge sparkle
        w.fx.ring(this.cx, this.body.y + 26, PAL.moon, 0.6, 0.3);
      }
      return 'dodged';
    }
    const fromFront = info.dir === -this.facing; // attacker pushes us opposite to its facing => it stands in front if dir==-facing
    if (this.state === 'BLOCK' && fromFront && !info.unblockable) {
      if (this.blockT <= PARRY_WINDOW) {
        this.stats.parries++;
        this.invuln = 0.35;
        audio.sfx('parry');
        w.fx.ring(this.cx + this.facing * 16, this.body.y + 24, PAL.white, 1.1, 0.3);
        w.fx.spark(this.cx + this.facing * 18, this.body.y + 24, this.facing, 14);
        w.fx.freeze(110);
        w.fx.slowmo(0.35, 0.28);
        w.fx.shake(3, 0.12);
        w.atmos.flash(0.25);
        w.debt.reduce(6);
        const att = info.attacker as Hittable | undefined;
        w.onParry(att && 'parried' in att ? att : null);
        return 'parried';
      }
      const dmg = Math.max(1, Math.round(info.damage * 0.25));
      this.hp -= dmg;
      this.stats.damageTaken += dmg;
      this.body.vx = -this.facing * Math.min(260, info.knock * 0.8);
      this.invuln = 0.15;
      audio.sfx('block');
      w.fx.spark(this.cx + this.facing * 14, this.body.y + 26, this.facing, 8);
      w.fx.shake(2, 0.1);
      this.blockT = 0.3;
      if (this.hp <= 0) this.die(w);
      return 'blocked';
    }
    // Real hit.
    this.hp -= info.damage;
    this.stats.damageTaken += info.damage;
    this.invuln = 1.0;
    this.flashT = 0.18;
    this.hurtT = Math.max(0.28, Math.min(0.5, info.stun));
    if (this.crouched) this.setCrouch(false, w);
    this.body.vx = info.dir * Math.max(140, info.knock);
    this.body.vy = -Math.max(180, info.knockUp + 180);
    this.setState('HURT');
    audio.sfx('hurt');
    w.fx.red(this.cx, this.body.y + 24, 10);
    w.fx.freeze(info.heavy ? 90 : 60);
    w.fx.shake(info.heavy ? 7 : 4, 0.22);
    w.atmos.flash(0.1);
    if (this.hp <= 0) this.die(w);
    return 'hit';
  }

  heal(n: number) {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  private die(w: IWorld) {
    this.hp = 0;
    this.dead = true;
    this.state = 'DEAD';
    this.stateT = 0;
    this.deathT = 0;
    if (this.crouched) {
      this.body.y -= PHYS.playerH - PHYS.slideH;
      this.body.h = PHYS.playerH;
      this.crouched = false;
    }
    this.body.vy = -260;
    this.body.vx = -this.facing * 140;
    audio.sfx('death');
    w.fx.shake(8, 0.4);
    w.fx.slowmo(0.3, 0.9);
    w.fx.red(this.cx, this.body.y + 24, 18);
    w.atmos.flash(0.3);
  }

  private updateDead(dt: number, w: IWorld) {
    this.deathT += dt;
    const b = this.body;
    b.vx = approach(b.vx, 0, 600 * dt);
    b.vy = Math.min(PHYS.maxFall, b.vy + PHYS.gravity * dt);
    moveBody(b, w.solids, dt);
    if (this.deathT > 1.5 && !this.deathNotified) {
      this.deathNotified = true;
      w.playerDied();
    }
  }

  /** Teleport back to the last safe ground after a fall; costs a little health but never kills. */
  fallRespawn(w: IWorld) {
    this.hp = Math.max(1, this.hp - 12);
    this.body.x = this.lastSafe.x - this.body.w / 2;
    this.body.y = this.lastSafe.y - this.body.h - 2;
    this.body.vx = 0;
    this.body.vy = 0;
    this.invuln = 1.4;
    this.setState('IDLE');
    this.cloth.reset(this.cx, this.body.y);
    audio.sfx('hurt');
    w.fx.shadowSmoke(this.cx, this.body.y + 30, 8);
  }

  teleport(x: number, feetY: number) {
    this.body.x = x - this.body.w / 2;
    this.body.y = feetY - this.body.h;
    this.body.vx = 0;
    this.body.vy = 0;
    this.lastSafe = { x, y: feetY };
    this.cloth.reset(x, feetY - 40);
  }

  /** Lock movement during scripted moments. */
  freezeState(s: PState) {
    this.setState(s);
  }

  private world: IWorld | null = null;
  bind(w: IWorld) {
    this.world = w;
  }

  private onLanded(w: IWorld) {
    const vy = this.lastVy;
    this.jumping = false;
    if (this.state === 'JUMP' || this.state === 'FALL' || this.state === 'WALL_JUMP' || this.state === 'WALL') {
      if (vy > 280) {
        this.landT = 0.1;
        this.setState('LAND');
        audio.sfx('land');
        w.fx.dust(this.cx, this.feetY - 1, vy > 600 ? 8 : 4);
        if (vy > 700) {
          w.fx.shake(3.5, 0.15);
          this.body.vx *= 0.4;
        }
      } else this.setState(Math.abs(this.body.vx) > 10 ? 'RUN' : 'IDLE');
    }
    if (this.state === 'ATTACK' && this.atkAir) this.atkAir = false;
    // Crumble tiles react to being stood on.
    const gs = this.body.groundSolid;
    if (gs && gs.kind === 'crumble' && (gs.crumble === undefined || gs.crumble < 0) && gs.active) {
      gs.crumble = 0.55;
      audio.sfx('crumble');
    }
  }

  private pushGhost(life: number) {
    this.ghosts.push({ x: this.cx, y: this.feetY, facing: this.facing, pose: this.pose(this.world!), life });
  }

  // ----------------------------------------------------------------- drawing
  private pose(w: IWorld): Pose {
    const p = neutralPose();
    const sprintK = clamp((Math.abs(this.body.vx) - 100) / 230, 0, 1);
    const hasBlade = this.abilities.blade;
    const t = this.t;
    const st = this.state;
    switch (st) {
      case 'IDLE': {
        const br = Math.sin(t * 2.2) * 0.02;
        p.lean = 0.06 + br;
        p.legF = [0.22, 0.14];
        p.legB = [-0.24, 0.14];
        p.armF = hasBlade ? [0.7, 0.8] : [0.2, 0.5];
        p.armB = [-0.15 + br, 0.4];
        p.weapon = hasBlade ? 1.35 + br : null;
        if (this.crouched) {
          p.lean = 0.5;
          p.legF = [1.05, 1.9];
          p.legB = [-0.35, 1.5];
          p.crouch = 1;
          p.armF = [0.8, 0.9];
          p.weapon = hasBlade ? 1.5 : null;
        }
        break;
      }
      case 'RUN':
      case 'SPRINT': {
        const ph = this.runPhase;
        const amp = 0.62 + sprintK * 0.5;
        const flex = 0.3 + sprintK * 0.8;
        const leg = (phase: number): [number, number] => [amp * Math.sin(phase), 0.18 + flex * Math.max(0, Math.cos(phase))];
        p.legF = leg(ph);
        p.legB = leg(ph + Math.PI);
        p.lean = 0.16 + sprintK * 0.28;
        p.lift = Math.abs(Math.sin(ph)) * 1.2;
        const swing = 0.8 + sprintK * 0.4;
        if (hasBlade && this.crouched === false) {
          // blade trailing behind while running
          p.armF = [-0.9 - sprintK * 0.4, 0.5];
          p.weapon = -1.7 - sprintK * 0.3;
        } else {
          p.armF = [-swing * Math.sin(ph), 1.1];
          p.weapon = null;
        }
        p.armB = [swing * Math.sin(ph), 1.1];
        p.head = -0.1;
        if (this.crouched) {
          p.lean = 0.6;
          p.legF = [1.0 + 0.3 * Math.sin(ph), 1.8];
          p.legB = [-0.3 - 0.3 * Math.sin(ph), 1.5];
        }
        break;
      }
      case 'JUMP':
        p.lean = 0.12;
        p.legF = [0.95, 1.5];
        p.legB = [-0.35, 0.7];
        p.armF = hasBlade ? [-1.0, 0.4] : [-1.6, 0.6];
        p.armB = [1.6, 0.5];
        p.weapon = hasBlade ? -1.9 : null;
        break;
      case 'WALL_JUMP':
        p.lean = 0.1;
        p.legF = [1.0, 1.6];
        p.legB = [0.3, 1.2];
        p.armF = [-2.4, 0.2];
        p.armB = [2.0, 0.4];
        p.weapon = hasBlade ? -2.3 : null;
        break;
      case 'FALL': {
        const fl = Math.sin(t * 18) * 0.06;
        p.lean = 0.05;
        p.legF = [0.3 + fl, 0.5];
        p.legB = [-0.45 - fl, 0.7];
        p.armF = [2.2, 0.3];
        p.armB = [-2.0, 0.3];
        p.weapon = hasBlade ? 2.6 : null;
        break;
      }
      case 'WALL':
        p.lean = -0.05;
        p.legF = [0.5, 0.9];
        p.legB = [0.1, 1.2];
        p.armF = [2.7, 0.15];
        p.armB = [2.3, 0.3];
        p.weapon = hasBlade ? -2.6 : null;
        break;
      case 'LAND': {
        const k = Math.min(1, this.stateT / 0.1);
        p.lean = 0.45 * (1 - k * 0.5);
        p.legF = [0.9, 1.7];
        p.legB = [-0.3, 1.4];
        p.armF = [0.9, 0.7];
        p.armB = [-0.3, 0.8];
        p.crouch = 1;
        p.weapon = hasBlade ? 1.5 : null;
        break;
      }
      case 'SLIDE':
        p.lean = -0.95;
        p.legF = [1.4, 0.0];
        p.legB = [0.4, 2.1];
        p.armF = [-0.9, 0.6];
        p.armB = [-1.3, 0.4];
        p.head = 0.9;
        p.weapon = hasBlade ? -1.7 : null;
        break;
      case 'VAULT': {
        const k = Math.min(1, this.vaultT / 0.35);
        p.lean = 0.4;
        p.lift = 4;
        p.legF = [1.35, 2.0 - k * 0.4];
        p.legB = [1.0, 2.1];
        p.armF = [0.9, 0.9];
        p.armB = [0.5, 1.2];
        p.weapon = hasBlade ? -1.2 : null;
        break;
      }
      case 'DODGE':
        p.lean = 0.9;
        p.legF = [1.3, 2.2];
        p.legB = [1.1, 2.3];
        p.armF = [1.2, 1.7];
        p.armB = [1.0, 1.6];
        p.weapon = null;
        break;
      case 'BLOCK': {
        p.lean = 0.12;
        p.legF = [0.55, 0.9];
        p.legB = [-0.45, 0.8];
        p.armF = [1.5, 0.5];
        p.armB = [1.1, 0.9];
        p.weapon = 2.55;
        p.crouch = 0.5;
        break;
      }
      case 'SHADOW':
        p.lean = 1.15;
        p.legF = [-0.9, 0.5];
        p.legB = [-1.35, 0.3];
        p.armF = [1.55, 0.05];
        p.armB = [-1.0, 0.3];
        p.weapon = hasBlade ? 1.57 : null;
        break;
      case 'HURT':
        p.lean = -0.45;
        p.head = -0.3;
        p.legF = [0.35, 0.8];
        p.legB = [-0.2, 0.5];
        p.armF = [-1.6, 0.5];
        p.armB = [2.0, 0.4];
        p.weapon = hasBlade ? -2.0 : null;
        break;
      case 'DEAD': {
        p.lean = -0.2;
        p.legF = [0.5, 1.0];
        p.legB = [0.1, 0.9];
        p.armF = [-1.4, 0.6];
        p.armB = [-1.0, 0.5];
        p.weapon = null;
        break;
      }
      case 'ATTACK':
        this.attackPose(p);
        break;
    }
    void w;
    return p;
  }

  private attackPose(p: Pose) {
    const def = this.atk;
    if (!def) return;
    const t = this.stateT;
    const aS = def.windup;
    const aE = def.windup + def.active;
    const total = aE + def.recover;
    let wa: number;
    let lean: number;
    if (t < aS) {
      const k = smooth(t / aS);
      wa = def.windFrom * (0.35 + 0.65 * k) + 1.3 * (1 - (0.35 + 0.65 * k));
      lean = -0.18 * k;
      p.legF = [0.35, 0.5 + (def.heavy ? 0.5 * k : 0)];
      p.legB = [-0.5, 0.4 + (def.heavy ? 0.4 * k : 0)];
      p.crouch = def.heavy ? k : 0;
    } else if (t < aE) {
      const k = (t - aS) / def.active;
      wa = def.windFrom + (def.to - def.windFrom) * 0 + (def.from - def.windFrom) * (1 - k) * 0;
      wa = def.from + (def.to - def.from) * smooth(k);
      lean = -0.18 + 0.7 * smooth(k);
      p.legF = [0.75, 0.35];
      p.legB = [-0.65, 0.3];
    } else {
      const k = smooth(Math.min(1, (t - aE) / def.recover));
      wa = def.to + (1.35 - def.to) * k;
      lean = 0.52 * (1 - k) + 0.06 * k;
      p.legF = [0.7 - 0.45 * k, 0.35];
      p.legB = [-0.62 + 0.35 * k, 0.3];
    }
    void total;
    p.weapon = wa;
    p.lean = lean;
    p.armF = [wa * 0.85, Math.max(-0.2, wa * 0.12 - 0.05)];
    p.armB = [-0.5 - lean, 0.6];
    if (this.atkAir) {
      p.legF = [0.9, 1.3];
      p.legB = [-0.3, 0.9];
    }
  }

  draw(w: IWorld) {
    const g = this.g;
    g.clear();
    const stage = w.debt.stage;
    const pose = this.pose(w);
    const alphaBase = this.invuln > 0 && this.state !== 'DODGE' && this.state !== 'SHADOW' && !this.dead
      ? (Math.floor(this.t * 20) % 2 === 0 ? 0.45 : 1) : 1;
    const x = this.cx;
    const y = this.feetY;
    let tilt = 0;
    if (this.state === 'DODGE') tilt = this.dodgeDir * 0 + (this.stateT / PHYS.dodgeTime) * Math.PI * 2;
    if (this.state === 'VAULT') tilt = Math.min(1, this.vaultT / 0.4) * Math.PI * 1.3 * 0.25;
    if (this.state === 'DEAD') tilt = -Math.min(1, this.deathT * 2.2) * 1.45;
    if (this.state === 'SLIDE') tilt = 0;

    // The bound shadow: a violet double that lags behind when Shadow Debt rises.
    if (stage >= 1 && !this.dead) {
      const off = -this.facing * (8 + stage * 6) + Math.sin(this.t * 3) * 3;
      drawRig(g, x + off, y + 2, this.facing, pose, this.style, {
        color: PAL.shadow, alpha: 0.12 + stage * 0.08, rim: false, eyeGlow: 0, tilt, showWeapon: false,
      });
    }
    // Afterimages from the shadow dash.
    for (const gh of this.ghosts) {
      drawRig(g, gh.x, gh.y, gh.facing, gh.pose, this.style, {
        color: PAL.shadow, alpha: Math.max(0, gh.life / 0.35) * 0.5, rim: false, eyeGlow: 0,
      });
    }
    // Aru himself.
    const scarf = this.cloth.pts;
    drawRig(g, x, y, this.facing, pose, this.style, {
      alpha: alphaBase,
      scarf,
      tilt,
      eyeGlow: this.state === 'DEAD' ? 0 : 1,
      flash: this.flashT / 0.18,
      weaponGlow: stage >= 2 || this.state === 'SHADOW' ? 1 : 0,
      rimAlpha: 0.55,
    });
    // Parry window feedback: brief ring glint on the blade.
    if (this.state === 'BLOCK' && this.blockT < PARRY_WINDOW) {
      g.lineStyle(2, PAL.white, 0.9 * (1 - this.blockT / PARRY_WINDOW));
      g.strokeCircle(x + this.facing * 16, y - 26, 10 + this.blockT * 40);
    }
  }

  destroy() {
    this.g.destroy();
  }
}
