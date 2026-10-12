import Phaser from 'phaser';
import { PAL, VIEW_H } from '../config/gameConfig';
import { Atmosphere } from '../render/Atmosphere';
import { ARU_STYLE, Cloth, Pose, SENTINEL_STYLE, drawRig, jointWorld, neutralPose } from '../render/Silhouette';
import { audio } from '../systems/AudioSystem';
import { input } from '../systems/InputSystem';
import { save } from '../systems/SaveSystem';
import { hud } from '../ui/HUD';
import { touch } from '../ui/TouchControls';
import { menus } from '../ui/Menus';
import { flow, session } from '../core/flow';
import { ensureTextures } from '../utils/assetFallbacks';
import { clamp, damp, easeInOut, lerp, smooth } from '../utils/math';

const ARU_BIG = { ...ARU_STYLE, scale: 1.32 };

// Timeline (seconds)
const T_MARCH = 3.8;
const T_NOTICE = 10.2;
const T_ALARM = 17.4;
const T_CHASE = 21.4;

// Chase path constants (distance along the rooftops, px)
const CHASE_X0 = 8000;

type Mode = 'run' | 'vault' | 'slide' | 'jump' | 'leap' | 'fall';
interface PathState { y: number; mode: Mode; k: number }

/** Scripted parkour route used for both Aru and his pursuers (they replay it with a delay). */
function pathAt(u: number): PathState {
  const arc = (a: number, b: number, base: number, h: number): PathState | null => {
    if (u >= a && u <= b) {
      const k = (u - a) / (b - a);
      return { y: base - Math.sin(Math.PI * k) * h, mode: 'vault', k };
    }
    return null;
  };
  let s = arc(335, 465, 440, 58);
  if (s) return s;
  if (u >= 520 && u <= 690) return { y: 440, mode: 'slide', k: (u - 520) / 170 };
  if (u >= 690 && u <= 890) {
    const k = (u - 690) / 200;
    return { y: 440 - Math.sin(Math.PI * k) * 100, mode: k < 0.5 ? 'jump' : 'fall', k };
  }
  s = arc(945, 1075, 440, 58);
  if (s) return s;
  if (u >= 1250 && u < 1330) return { y: Math.min(500, 440 + (u - 1250) * 1.3), mode: 'fall', k: 0.6 };
  if (u >= 1330 && u < 1690) return { y: 500, mode: 'run', k: 0 };
  if (u >= 1690) {
    const k = (u - 1690) / 560;
    return { y: 500 - Math.sin(Math.PI * clamp(k, 0, 1)) * 200, mode: 'leap', k };
  }
  return { y: u < 700 ? 440 : u < 1250 ? 440 : 500, mode: 'run', k: 0 };
}

export class IntroScene extends Phaser.Scene {
  private then: 'game' | 'menu' = 'menu';
  private t = 0;
  private W = 960;
  private atmos!: Atmosphere;
  private g!: Phaser.GameObjects.Graphics;
  private redFlash!: Phaser.GameObjects.Rectangle;
  private torchGlows: Phaser.GameObjects.Image[] = [];
  private symbolGlow!: Phaser.GameObjects.Image;
  private relicGlow!: Phaser.GameObjects.Image;
  private dom!: HTMLElement;
  private textEl!: HTMLElement;
  private titleH!: HTMLElement;
  private titleP!: HTMLElement;
  private cloth = new Cloth(11, 5.6);
  private u = 0;
  private camX = 0;
  private camY = 0;
  private finishing = false;
  private titleMode = false;
  private fired = new Set<string>();
  private unsub: (() => void) | null = null;
  private emitter?: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('Intro');
  }

  init(data: { then?: 'game' | 'menu' }) {
    this.then = data?.then ?? 'menu';
  }

  create() {
    ensureTextures(this);
    this.t = 0;
    this.u = 0;
    this.finishing = false;
    this.titleMode = false;
    this.fired.clear();
    this.W = this.scale.width;
    this.cameras.main.setBackgroundColor('#000000');
    this.cameras.main.setZoom(1);
    this.atmos = new Atmosphere(this, 'fortress', this.W, 300, true, true);
    this.g = this.add.graphics().setDepth(10);
    this.redFlash = this.add.rectangle(0, 0, this.W, VIEW_H, PAL.crimson).setOrigin(0).setScrollFactor(0).setDepth(80).setAlpha(0);
    this.symbolGlow = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xe0a040).setAlpha(0).setDepth(9);
    this.relicGlow = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd27a).setAlpha(0).setDepth(12);
    for (let i = 0; i < 14; i++) {
      this.torchGlows.push(this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xe0a040).setAlpha(0).setScale(3.4).setDepth(8));
    }
    this.emitter = this.add.particles(0, 0, 'dot', {
      x: { min: 0, max: this.W }, y: VIEW_H + 10, lifespan: { min: 2500, max: 4500 }, speedY: { min: -90, max: -40 }, speedX: { min: -20, max: 20 },
      scale: { start: 0.35, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: 0xe0a040, blendMode: 'ADD', frequency: 60, emitting: false,
    }).setScrollFactor(0).setDepth(70);

    hud.hide();
    touch.setActive(false);
    menus.hideAll();
    hud.fadeNow(true);
    this.buildDom();
    this.cloth.reset(900, 400);

    audio.unlock();
    audio.setMood('off');
    audio.setRain(true, 0.7);

    this.unsub = input.onAny(() => {
      /* keys handled below to avoid accidental skipping */
    });
    // (Phaser's keyboard plugin ignores events our global input handler already consumed, so listen directly.)
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') this.skip();
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKey);
      if (!this.titleMode) this.atmos?.destroy();
      this.dom?.remove();
      this.unsub?.();
    });
  }

  private buildDom() {
    const root = document.getElementById('overlay-root')!;
    const dom = document.createElement('div');
    dom.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:35';
    dom.innerHTML = `
      <div class="bars on"></div>
      <div class="cine-text"></div>
      <div class="cine-title"><h1>ASHVA</h1><p>Rise of the Forgotten</p></div>
      <button class="skip" style="pointer-events:auto">Skip &rsaquo;</button>`;
    root.appendChild(dom);
    this.dom = dom;
    this.textEl = dom.querySelector('.cine-text')!;
    this.titleH = dom.querySelector('.cine-title h1')!;
    this.titleP = dom.querySelector('.cine-title p')!;
    dom.querySelector('.skip')!.addEventListener('click', () => this.skip());
    // The bars start hidden and slide in.
    const bars = dom.querySelector('.bars')!;
    bars.classList.remove('on');
    window.setTimeout(() => bars.classList.add('on'), 300);
  }

  private say(text: string | null) {
    if (text) {
      this.textEl.textContent = text;
      this.textEl.classList.add('on');
    } else this.textEl.classList.remove('on');
  }

  private once(key: string, at: number, fn: () => void) {
    if (this.t >= at && !this.fired.has(key)) {
      this.fired.add(key);
      fn();
    }
  }

  private skip() {
    if (this.finishing || this.t < 0.8) return;
    this.finishing = true;
    hud.fade(true, 500).then(() => this.complete());
  }

  private complete() {
    this.dom.remove();
    audio.setRain(false);
    const sv = save.get();
    sv.introSeen = true;
    save.flush();
    if (this.then === 'game') {
      session.reset(sv.playSeconds, sv.deaths);
      flow.startLevel(sv.levelId, sv.checkpoint);
    } else flow.toMenu();
  }

  // ----------------------------------------------------------------- update
  update(_time: number, delta: number) {
    if (this.titleMode) return;
    const dt = Math.min(delta / 1000, 0.05);
    this.t += dt;
    const t = this.t;
    const g = this.g;
    g.clear();
    this.W = this.scale.width;
    const cam = this.cameras.main;

    // ---------------------------------------------------------- scheduled cues
    this.once('fadein', 0.05, () => hud.fade(false, 2200));
    this.once('thunder0', 2.4, () => this.atmos.strike());
    this.once('music1', T_MARCH, () => audio.setMood('sorrow'));
    this.once('bell1', T_ALARM + 0.2, () => audio.sfx('bell'));
    this.once('bell2', T_ALARM + 1.1, () => audio.sfx('bell'));
    this.once('bell3', T_ALARM + 2.0, () => audio.sfx('bell'));
    this.once('tense', T_ALARM + 0.4, () => audio.setMood('tense'));
    this.once('relicsfx', T_NOTICE + 3.2, () => audio.sfx('relic'));
    this.once('shadowsfx', T_NOTICE + 5.2, () => audio.sfx('shadow'));

    // Narration lines.
    if (t < T_MARCH) this.say(t > 0.9 && t < 3.3 ? 'Beneath every kingdom, something sleeps.' : null);
    else if (t < T_NOTICE) this.say(t > 5.0 && t < 9.0 ? 'Order.  Obedience.  Silence.' : null);
    else if (t < T_ALARM) this.say(t > 14.4 && t < 17.0 ? 'Some doors were never meant to open.' : null);
    else if (t < T_CHASE) this.say(t > 18.2 && t < 21.0 ? 'The Order does not forgive curiosity.' : null);
    else this.say(null);

    if (t < T_CHASE) this.wallShots(dt, t, cam);
    else this.chaseShot(dt, t, cam);

    // Whole-timeline fade out for a hard cut to the title.
    this.atmos.update(dt, this.camX, this.camY);
    this.redFlash.setSize(this.W, VIEW_H);
  }

  // ======================================================== shots 0-3: the wall
  private wallShots(dt: number, t: number, cam: Phaser.Cameras.Scene2D.Camera) {
    const g = this.g;
    const W = this.W;
    // Camera rig
    let cx: number;
    let cy = 270;
    let zoom = 1;
    const aruX = this.aruWallX(t);
    if (t < T_NOTICE) {
      cx = lerp(560, 960, easeInOut(clamp(t / T_NOTICE, 0, 1)));
    } else if (t < T_ALARM) {
      const k = smooth(clamp((t - T_NOTICE) / 2.6, 0, 1));
      cx = lerp(960, aruX - 40, k);
      cy = lerp(270, 400, k);
      zoom = lerp(1, 1.85, k);
    } else {
      const k = smooth(clamp((t - T_ALARM) / 1.8, 0, 1));
      cx = lerp(aruX - 40, aruX + 160, k);
      cy = lerp(400, 300, k);
      zoom = lerp(1.85, 1.0, k);
    }
    cam.setZoom(zoom);
    cam.centerOn(cx, cy);
    this.camX = cx - W / 2;
    this.camY = cy - VIEW_H / 2;

    // ---- facade, floor, alcoves
    const x0 = this.camX - 200;
    const x1 = this.camX + W + 200;
    g.fillStyle(0x080c14, 1);
    g.fillRect(x0, 215, x1 - x0, 400);
    g.fillStyle(0x0d1420, 1);
    g.fillRect(x0, 472, x1 - x0, 300);
    g.lineStyle(2, 0x6f86a8, 0.45);
    g.beginPath();
    g.moveTo(x0, 472);
    g.lineTo(x1, 472);
    g.moveTo(x0, 216);
    g.lineTo(x1, 216);
    g.strokePath();
    // merlons on the wall top
    g.fillStyle(0x080c14, 1);
    for (let x = Math.floor(x0 / 46) * 46; x < x1; x += 46) g.fillRect(x, 196, 26, 20);
    // brick courses
    g.lineStyle(1, 0x131c2c, 1);
    for (let y = 236; y < 470; y += 26) {
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.strokePath();
    }
    // arched alcoves + torch brackets every 260 px
    for (let x = Math.floor(x0 / 260) * 260; x < x1; x += 260) {
      g.fillStyle(0x04060a, 1);
      g.fillRect(x + 70, 300, 70, 172);
      g.fillEllipse(x + 105, 300, 70, 56);
      g.lineStyle(1.5, 0x2a3850, 0.8);
      g.strokeRect(x + 70, 300, 70, 172);
      g.fillStyle(0x1a2232, 1);
      g.fillRect(x + 20, 320, 4, 24);
    }

    // ---- torch glows (ignite in sequence during the alarm)
    this.torchGlows.forEach((img, i) => {
      const tx = i * 260 + 22 - 260 * 2 + Math.floor((this.camX + 500) / 260) * 0;
      const wx = i * 260 + 22;
      img.setPosition(wx, 322);
      const start = T_ALARM + 0.5 + i * 0.16;
      const on = clamp((t - start) / 0.4, 0, 1);
      const flick = 0.85 + Math.sin(t * 17 + i * 3) * 0.1;
      img.setAlpha(on * flick);
      void tx;
      if (on > 0) {
        g.fillStyle(PAL.amberHot, on);
        g.fillTriangle(wx - 3, 320, wx + 3, 320, wx, 308);
      }
    });

    // ---- the forbidden symbol (appears as Aru notices it)
    const sx = 1170;
    const sy = 340;
    const seen = clamp((t - (T_NOTICE + 2.2)) / 1.4, 0, 1);
    const pulse = 0.6 + Math.sin(t * 3.2) * 0.2;
    this.symbolGlow.setPosition(sx, sy).setScale(2.2 + seen * 1.6).setAlpha(seen * 0.55 * pulse);
    if (seen > 0) {
      g.lineStyle(2, PAL.amber, seen * 0.9);
      g.strokeCircle(sx, sy, 46);
      g.strokeCircle(sx, sy, 30);
      g.strokeCircle(sx, sy, 8);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + t * 0.4;
        g.beginPath();
        g.moveTo(sx + Math.cos(a) * 30, sy + Math.sin(a) * 30);
        g.lineTo(sx + Math.cos(a) * 46, sy + Math.sin(a) * 46);
        g.strokePath();
        g.lineStyle(2, PAL.amberHot, seen * 0.8);
        g.strokeCircle(sx + Math.cos(a) * 38, sy + Math.sin(a) * 38, 3.2);
        g.lineStyle(2, PAL.amber, seen * 0.9);
      }
      // two crossed strokes through the circle
      g.beginPath();
      g.moveTo(sx - 20, sy - 20);
      g.lineTo(sx + 20, sy + 20);
      g.moveTo(sx + 20, sy - 20);
      g.lineTo(sx - 20, sy + 20);
      g.strokePath();
    }

    // ---- guards
    const alarmK = t >= T_ALARM + 0.7 ? 1 : 0;
    const n = 9;
    for (let i = 0; i < n; i++) {
      let gx: number;
      let facing: 1 | -1 = 1;
      let pose: Pose = neutralPose();
      const ph = t * 5.4;
      if (!alarmK) {
        gx = 140 + i * 118 + t * 56;
        const amp = 0.42;
        const leg = (a: number): [number, number] => [amp * Math.sin(a), 0.12 + 0.55 * Math.max(0, Math.cos(a))];
        pose.legF = leg(ph);
        pose.legB = leg(ph + Math.PI);
        pose.lean = 0.03;
        pose.armF = [0.25, 0.6];
        pose.armB = [-0.28 * Math.sin(ph), 0.4];
        pose.weapon = 3.1;
      } else {
        // all of them stop and snap toward Aru in unison
        const stopT = T_ALARM + 0.7;
        gx = 140 + i * 118 + stopT * 56;
        facing = -1;
        const k = smooth(clamp((t - stopT) / 0.5, 0, 1));
        pose.lean = 0.2 * k;
        pose.legF = [0.5 * k, 0.4];
        pose.legB = [-0.45 * k, 0.4];
        pose.armF = [0.9 * k, 0.6];
        pose.armB = [0.2, 0.6];
        pose.weapon = lerp(3.1, 1.65, k);
      }
      drawRig(g, gx, 462, facing, pose, SENTINEL_STYLE, { eyeGlow: alarmK ? 1 : 0.35, alpha: 0.96, rimAlpha: 0.35 });
    }

    // ---- Aru
    if (t > 7.0) {
      this.drawAruWall(g, dt, t, aruX);
    }

    // ---- alarm tint
    if (t > T_ALARM && t < T_CHASE + 0.2) {
      const k = (Math.sin((t - T_ALARM) * 8) * 0.5 + 0.5) * 0.26;
      this.redFlash.setAlpha(k * clamp((T_CHASE - t) / 1.2, 0, 1));
    } else this.redFlash.setAlpha(0);
    this.once('shakeA', T_ALARM + 0.2, () => this.cameras.main.shake(260, 0.006));
    this.once('shakeB', T_ALARM + 1.1, () => this.cameras.main.shake(260, 0.007));
    this.once('shakeC', T_ALARM + 2.0, () => this.cameras.main.shake(320, 0.009));
  }

  private aruWallX(t: number): number {
    // Aru walks left across the front, against the marching column, then stops at the symbol.
    const stopT = T_NOTICE + 1.4;
    if (t < 7.0) return 1700;
    const walkT = Math.min(t, stopT) - 7.0;
    return 1700 - walkT * 78 - (t > stopT ? 0 : 0);
  }

  private drawAruWall(g: Phaser.GameObjects.Graphics, dt: number, t: number, ax: number) {
    const stopT = T_NOTICE + 1.4;
    const walking = t < stopT;
    const y = 508;
    const pose = neutralPose();
    const ph = t * 4.6;
    let facing: 1 | -1 = -1;
    if (walking) {
      const amp = 0.4;
      const leg = (a: number): [number, number] => [amp * Math.sin(a), 0.12 + 0.55 * Math.max(0, Math.cos(a))];
      pose.legF = leg(ph);
      pose.legB = leg(ph + Math.PI);
      pose.lean = 0.12;
      pose.armF = [0.2, 0.5];
      pose.armB = [-0.3 * Math.sin(ph), 0.4];
    } else {
      const k = smooth(clamp((t - stopT) / 0.6, 0, 1));
      pose.lean = 0.02 - 0.08 * k;
      pose.head = -0.35 * k; // looks up at the symbol
      pose.legF = [0.2, 0.15];
      pose.legB = [-0.15, 0.15];
      // after a moment his hand goes to the satchel
      const hand = smooth(clamp((t - (T_NOTICE + 3.0)) / 0.7, 0, 1));
      pose.armF = [lerp(0.15, 0.7, hand), lerp(0.4, 1.3, hand)];
      pose.armB = [-0.1, 0.4];
    }
    if (t > T_ALARM + 1.0) facing = -1;
    const neck = jointWorld('neck', pose, ARU_BIG, ax, y, facing);
    this.cloth.update(neck.x, neck.y, -facing, dt, t);
    drawRig(g, ax, y, facing, pose, ARU_BIG, { scarf: this.cloth.pts, rimAlpha: 0.7 });

    // The relic stirs: a light grows from his satchel; the shadow stands up on the wall.
    const rk = clamp((t - (T_NOTICE + 3.2)) / 2.0, 0, 1);
    const hip = jointWorld('hip', pose, ARU_BIG, ax, y, facing);
    this.relicGlow.setPosition(hip.x + 10, hip.y).setScale(0.6 + rk * 3.2 + Math.sin(t * 9) * 0.1).setAlpha(rk * 0.9);
    if (rk > 0) {
      g.fillStyle(PAL.amberHot, rk);
      g.fillCircle(hip.x + 10, hip.y, 4 + rk * 3);
      // light rays
      g.lineStyle(1.5, PAL.amberHot, rk * 0.5);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + t * 0.7;
        g.beginPath();
        g.moveTo(hip.x + 10 + Math.cos(a) * 8, hip.y + Math.sin(a) * 8);
        g.lineTo(hip.x + 10 + Math.cos(a) * (30 + rk * 30), hip.y + Math.sin(a) * (30 + rk * 30));
        g.strokePath();
      }
    } else this.relicGlow.setAlpha(0);

    const sk = smooth(clamp((t - (T_NOTICE + 5.0)) / 1.6, 0, 1));
    if (sk > 0 && t < T_CHASE) {
      // His shadow on the facade rises to its full height, independent of him.
      const sp = neutralPose();
      sp.lean = 0.05 - sk * 0.1;
      sp.head = -0.2 * sk;
      sp.legF = [0.25, 0.1];
      sp.legB = [-0.25, 0.1];
      sp.armF = [lerp(0.2, 2.4, sk), 0.2];
      sp.armB = [lerp(-0.2, -2.2, sk), 0.2];
      const big = { ...ARU_STYLE, scale: 2.7 };
      drawRig(g, ax - 150 + sk * 40, 470, -1, sp, big, { color: PAL.shadow, alpha: 0.38 * sk, rim: false, eyeGlow: 0, scarf: undefined });
      g.fillStyle(PAL.white, 0.9 * sk);
      g.fillRect(ax - 150 + sk * 40 - 14 - 3, 470 - 150, 7, 3);
    }
  }

  // ================================================================ shot 4+: chase
  private chaseShot(dt: number, t: number, cam: Phaser.Cameras.Scene2D.Camera) {
    const g = this.g;
    const W = this.W;
    this.redFlash.setAlpha(0);
    this.torchGlows.forEach((i) => i.setAlpha(0));
    this.symbolGlow.setAlpha(0);
    this.relicGlow.setAlpha(0);
    cam.setZoom(1);

    const tc = t - T_CHASE;
    // Advance the runner (slow down for the final leap).
    if (!this.fired.has('whiteout')) {
      const speed = this.u >= 1760 && this.u < 2200 ? 150 : 330;
      this.u += speed * dt * (tc < 0.01 ? 0 : 1);
    }
    const u = this.u;
    const st = pathAt(u);
    const ax = CHASE_X0 + u;

    this.once('chaseflash', T_CHASE + 0.02, () => this.atmos.flash(0.7));
    if (u > 360) this.once('thunder1', T_CHASE, () => this.atmos.strike());
    if (u > 990) this.once('thunder2', T_CHASE + 99, () => this.atmos.strike());
    if (u > 1000) this.once('flash2', T_CHASE + 0, () => this.atmos.flash(0.4));
    if (u > 1700) this.once('slowfx', T_CHASE, () => audio.sfx('whoosh'));
    if (u > 1700) this.once('leapfx', T_CHASE + 0.01, () => audio.sfx('shadow'));

    // ---- camera: follows, then locks Aru against the moon for the leap
    const follow = { x: ax + W * 0.12, y: st.y - 140 };
    const moonLock = { x: ax - W * 0.74 + W / 2, y: st.y - 118 + VIEW_H / 2 - 20 };
    const lockK = smooth(clamp((u - 1700) / 260, 0, 1));
    const tx = lerp(follow.x, moonLock.x, lockK);
    const ty = lerp(follow.y, moonLock.y, lockK);
    if (tc < 0.05) {
      this.camX = tx - W / 2;
      this.camY = ty - VIEW_H / 2;
    }
    this.camX = damp(this.camX, tx - W / 2, 6, dt);
    this.camY = damp(this.camY, ty - VIEW_H / 2, 4, dt);
    cam.setScroll(this.camX, this.camY);

    // ---- rooftops
    const roof = (a: number, b: number, y: number) => {
      const ra = CHASE_X0 + a;
      const rb = CHASE_X0 + b;
      if (rb < this.camX - 50 || ra > this.camX + W + 50) return;
      g.fillStyle(0x05080e, 1);
      g.fillRect(ra, y, rb - ra, 400);
      g.fillTriangle(ra, y, ra - 18, y - 8, ra, y + 10);
      g.fillTriangle(rb, y, rb + 18, y - 8, rb, y + 10);
      g.lineStyle(2, 0x6f86a8, 0.75);
      g.beginPath();
      g.moveTo(ra, y + 1);
      g.lineTo(rb, y + 1);
      g.strokePath();
      g.lineStyle(1, 0x131c2c, 1);
      for (let yy = y + 14; yy < y + 120; yy += 18) {
        g.beginPath();
        g.moveTo(ra, yy);
        g.lineTo(rb, yy);
        g.strokePath();
      }
    };
    roof(-1500, 700, 440);
    roof(840, 1250, 440);
    roof(1250, 1700, 500);
    // crate, beam, second crate
    g.fillStyle(0x0d1420, 1);
    g.fillRect(CHASE_X0 + 395, 404, 40, 36);
    g.lineStyle(2, 0x6f86a8, 0.6);
    g.strokeRect(CHASE_X0 + 395, 404, 40, 36);
    g.fillRect(CHASE_X0 + 1010, 404, 40, 36);
    g.strokeRect(CHASE_X0 + 1010, 404, 40, 36);
    g.fillStyle(0x05080e, 1);
    g.fillRect(CHASE_X0 + 540, 330, 170, 70);
    g.lineStyle(2, PAL.amber, 0.5);
    g.beginPath();
    g.moveTo(CHASE_X0 + 540, 400);
    g.lineTo(CHASE_X0 + 710, 400);
    g.strokePath();
    // lanterns on poles
    for (const lu of [140, 880, 1300]) {
      const lx = CHASE_X0 + lu;
      const ly = lu === 1300 ? 500 : 440;
      g.fillStyle(0x05080e, 1);
      g.fillRect(lx, ly - 90, 3, 90);
      g.fillStyle(PAL.amberHot, 0.9);
      g.fillRect(lx - 4, ly - 94, 10, 12);
    }

    // ---- pursuers (replay the path with delays)
    for (let i = 0; i < 7; i++) {
      const pu = u - 150 - i * 64 - (i % 2) * 22;
      const ps = pathAt(pu);
      const ph = (CHASE_X0 + pu) * 0.05;
      const pr = this.poseFor(ps, ph, false);
      drawRig(g, CHASE_X0 + pu, ps.y, 1, pr.pose, SENTINEL_STYLE, { tilt: pr.tilt, eyeGlow: 1, alpha: 0.97, rimAlpha: 0.3 });
    }

    // ---- Aru
    const ph = ax * 0.052;
    const ar = this.poseFor(st, ph, true);
    const neck = jointWorld('neck', ar.pose, ARU_BIG, ax, st.y, 1);
    this.cloth.update(neck.x, neck.y, -1, dt, t);
    for (let i = 1; i < this.cloth.pts.length; i++) this.cloth.pts[i].x -= 1.2;
    drawRig(g, ax, st.y, 1, ar.pose, { ...ARU_STYLE, scale: 1.12 }, { scarf: this.cloth.pts, tilt: ar.tilt, rimAlpha: 0.75 });

    // ---- the cut: whiteout at the apex, then the title
    if (u >= 1990 && !this.fired.has('whiteout')) {
      this.fired.add('whiteout');
      this.atmos.flash(1);
      audio.sfx('slam');
      this.cameras.main.shake(300, 0.012);
      hud.fade(true, 350).then(() => this.showTitle());
    }
  }

  private poseFor(st: PathState, ph: number, hero: boolean): { pose: Pose; tilt: number } {
    const pose = neutralPose();
    let tilt = 0;
    const run = (amp: number, flex: number) => {
      const leg = (a: number): [number, number] => [amp * Math.sin(a), 0.2 + flex * Math.max(0, Math.cos(a))];
      pose.legF = leg(ph);
      pose.legB = leg(ph + Math.PI);
      pose.armF = [-0.9 * Math.sin(ph), 1.1];
      pose.armB = [0.9 * Math.sin(ph), 1.1];
      pose.lean = 0.42;
      pose.weapon = hero ? null : 1.55;
      if (!hero) pose.armF = [1.0, 0.4];
    };
    switch (st.mode) {
      case 'run':
        run(0.95, 1.0);
        break;
      case 'vault':
        pose.lean = 0.45;
        pose.lift = 4;
        pose.legF = [1.35, 2.0];
        pose.legB = [1.0, 2.1];
        pose.armF = [0.9, 0.9];
        pose.armB = [0.5, 1.2];
        pose.weapon = hero ? null : 1.5;
        tilt = Math.sin(st.k * Math.PI) * 0.35;
        break;
      case 'slide':
        pose.lean = -0.95;
        pose.legF = [1.4, 0.0];
        pose.legB = [0.4, 2.1];
        pose.armF = [-0.9, 0.6];
        pose.armB = [-1.3, 0.4];
        pose.head = 0.9;
        pose.weapon = hero ? null : -1.5;
        break;
      case 'jump':
        pose.lean = 0.2;
        pose.legF = [0.95, 1.5];
        pose.legB = [-0.35, 0.7];
        pose.armF = [-1.2, 0.4];
        pose.armB = [1.6, 0.5];
        pose.weapon = hero ? null : 1.4;
        break;
      case 'fall':
        pose.lean = 0.1;
        pose.legF = [0.4, 0.5];
        pose.legB = [-0.45, 0.7];
        pose.armF = [2.0, 0.3];
        pose.armB = [-1.8, 0.3];
        pose.weapon = hero ? null : 2.4;
        break;
      case 'leap': {
        // Arms flung wide, legs trailing, body arched at the apex.
        const k = st.k;
        pose.lean = lerp(0.9, 0.0, smooth(clamp(k * 1.4, 0, 1)));
        pose.legF = [lerp(1.2, 0.35, k), lerp(1.7, 0.4, k)];
        pose.legB = [lerp(-0.2, -0.8, k), lerp(0.8, 0.3, k)];
        pose.armF = [lerp(1.4, 2.5, k), 0.15];
        pose.armB = [lerp(-1.0, -2.2, k), 0.15];
        pose.head = -0.15;
        pose.weapon = hero ? null : 2.4;
        break;
      }
    }
    return { pose, tilt };
  }

  // =============================================================== title card
  private showTitle() {
    // Reset the world to a black stage with rising embers.
    this.titleMode = true;
    this.g.clear();
    this.atmos.destroy();
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setBackgroundColor('#000000');
    this.emitter?.start();
    this.say(null);
    audio.setMood('off');
    hud.fade(false, 200);
    window.setTimeout(() => {
      this.titleH.classList.add('on');
      audio.sfx('slam');
      audio.thunder(0.05);
    }, 300);
    window.setTimeout(() => {
      this.titleP.classList.add('on');
      audio.sfx('bell');
    }, 1500);
    window.setTimeout(() => {
      if (this.finishing) return;
      this.finishing = true;
      hud.fade(true, 1400).then(() => this.complete());
    }, 6200);
  }
}
