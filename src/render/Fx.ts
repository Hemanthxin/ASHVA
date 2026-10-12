import Phaser from 'phaser';
import { save } from '../systems/SaveSystem';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

interface Slash {
  x: number; y: number; facing: 1 | -1; r0: number; r1: number; a0: number; a1: number; color: number; life: number; max: number;
}

/**
 * Pooled effects: particle bursts, shockwave rings, weapon trails, camera shake, hit-stop and
 * slow motion. Everything is created once per scene and re-used.
 */
export class Fx {
  private sparkR: Emitter;
  private sparkL: Emitter;
  private sparkAmber: Emitter;
  private sparkRed: Emitter;
  private sparkViolet: Emitter;
  private dustE: Emitter;
  private smokeE: Emitter;
  private smokeViolet: Emitter;
  private emberE: Emitter;
  private rings: Phaser.GameObjects.Image[] = [];
  private ringIdx = 0;
  private slashG: Phaser.GameObjects.Graphics;
  private slashes: Slash[] = [];
  private cam: Phaser.Cameras.Scene2D.Camera;

  shakeT = 0;
  shakeMax = 0.001;
  shakeMag = 0;
  shakeX = 0;
  shakeY = 0;
  hitstop = 0;
  timeScale = 1;
  private slowTarget = 1;
  private slowT = 0;

  constructor(private scene: Phaser.Scene, depth = 20) {
    this.cam = scene.cameras.main;
    const mk = (tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) => {
      const e = scene.add.particles(0, 0, tex, { emitting: false, ...cfg });
      e.setDepth(depth);
      return e;
    };
    const base = { lifespan: { min: 180, max: 420 }, speed: { min: 90, max: 300 }, gravityY: 700, scale: { start: 0.55, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD' as const };
    this.sparkR = mk('dot', { ...base, angle: { min: -60, max: 40 }, tint: 0xffe6b0 });
    this.sparkL = mk('dot', { ...base, angle: { min: 140, max: 240 }, tint: 0xffe6b0 });
    this.sparkAmber = mk('dot', { ...base, angle: { min: 0, max: 360 }, tint: 0xe0a040 });
    this.sparkRed = mk('dot', { ...base, angle: { min: 0, max: 360 }, tint: 0xff3b3b });
    this.sparkViolet = mk('dot', { ...base, angle: { min: 0, max: 360 }, speed: { min: 40, max: 200 }, gravityY: -30, lifespan: { min: 300, max: 700 }, tint: 0x9a7cff });
    this.dustE = mk('smoke', {
      lifespan: { min: 300, max: 600 }, speed: { min: 10, max: 70 }, angle: { min: 190, max: 350 }, gravityY: -10,
      scale: { start: 0.35, end: 0.9 }, alpha: { start: 0.35, end: 0 }, tint: 0x8aa0b8,
    });
    this.smokeE = mk('smoke', {
      lifespan: { min: 500, max: 1100 }, speed: { min: 10, max: 60 }, angle: { min: 0, max: 360 }, gravityY: -40,
      scale: { start: 0.5, end: 1.4 }, alpha: { start: 0.6, end: 0 }, tint: 0x05070b,
    });
    this.smokeViolet = mk('smoke', {
      lifespan: { min: 400, max: 900 }, speed: { min: 10, max: 60 }, angle: { min: 0, max: 360 }, gravityY: -50,
      scale: { start: 0.4, end: 1.1 }, alpha: { start: 0.5, end: 0 }, tint: 0x6a48e0, blendMode: 'ADD',
    });
    this.emberE = mk('dot', {
      lifespan: { min: 700, max: 1400 }, speed: { min: 30, max: 150 }, angle: { min: 200, max: 340 }, gravityY: -60,
      scale: { start: 0.45, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', tint: 0xffb454,
    });
    for (let i = 0; i < 6; i++) {
      this.rings.push(scene.add.image(0, 0, 'ring').setVisible(false).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 1));
    }
    this.slashG = scene.add.graphics().setDepth(depth + 2);
  }

  private get reduced() {
    return save.settings.reducedFx;
  }

  spark(x: number, y: number, dir: 1 | -1, n = 8) {
    const k = this.reduced ? Math.ceil(n / 2) : n;
    (dir > 0 ? this.sparkR : this.sparkL).explode(k, x, y);
  }
  amber(x: number, y: number, n = 10) {
    this.sparkAmber.explode(this.reduced ? Math.ceil(n / 2) : n, x, y);
  }
  red(x: number, y: number, n = 10) {
    this.sparkRed.explode(this.reduced ? Math.ceil(n / 2) : n, x, y);
  }
  violet(x: number, y: number, n = 8) {
    this.sparkViolet.explode(this.reduced ? Math.ceil(n / 2) : n, x, y);
  }
  dust(x: number, y: number, n = 5) {
    this.dustE.explode(this.reduced ? Math.ceil(n / 2) : n, x, y);
  }
  smoke(x: number, y: number, n = 6) {
    this.smokeE.explode(this.reduced ? Math.ceil(n / 2) : n, x, y);
  }
  shadowSmoke(x: number, y: number, n = 6) {
    this.smokeViolet.explode(this.reduced ? Math.ceil(n / 2) : n, x, y);
  }
  embers(x: number, y: number, n = 8) {
    this.emberE.explode(this.reduced ? Math.ceil(n / 2) : n, x, y);
  }

  ring(x: number, y: number, color: number, size = 1, dur = 0.4) {
    const r = this.rings[this.ringIdx++ % this.rings.length];
    this.scene.tweens.killTweensOf(r);
    r.setPosition(x, y).setTint(color).setAlpha(0.9).setScale(0.15 * size).setVisible(true);
    this.scene.tweens.add({
      targets: r, scale: size, alpha: 0, duration: dur * 1000, ease: 'Cubic.easeOut',
      onComplete: () => r.setVisible(false),
    });
  }

  /** Weapon trail: a fading fan between two weapon angles. */
  slash(x: number, y: number, facing: 1 | -1, r0: number, r1: number, a0: number, a1: number, color = 0xdfeaff, life = 0.16) {
    this.slashes.push({ x, y, facing, r0, r1, a0, a1, color, life, max: life });
    if (this.slashes.length > 6) this.slashes.shift();
  }

  shake(mag: number, dur = 0.2) {
    if (!save.settings.screenShake) return;
    const cur = this.shakeT > 0 ? this.shakeMag * (this.shakeT / this.shakeMax) : 0;
    if (mag >= cur) {
      this.shakeMag = mag;
      this.shakeT = dur;
      this.shakeMax = dur;
    }
  }

  freeze(ms: number) {
    this.hitstop = Math.max(this.hitstop, ms / 1000);
  }

  slowmo(scale: number, dur: number) {
    this.timeScale = scale;
    this.slowTarget = scale;
    this.slowT = dur;
  }

  update(realDt: number) {
    // slow-mo recovery
    if (this.slowT > 0) {
      this.slowT -= realDt;
      if (this.slowT <= 0) this.timeScale = 1;
    }
    if (this.hitstop > 0) this.hitstop -= realDt;
    // shake
    if (this.shakeT > 0) {
      this.shakeT -= realDt;
      const k = Math.max(0, this.shakeT / this.shakeMax);
      this.shakeX = (Math.random() * 2 - 1) * this.shakeMag * k;
      this.shakeY = (Math.random() * 2 - 1) * this.shakeMag * k;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
      this.shakeMag = 0;
    }
    // trails
    const g = this.slashG;
    g.clear();
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.life -= realDt;
      if (s.life <= 0) {
        this.slashes.splice(i, 1);
        continue;
      }
      const k = s.life / s.max;
      const steps = 8;
      // angles: 0=down, +forward, PI=up -> convert to canvas angles
      for (let pass = 0; pass < 2; pass++) {
        g.fillStyle(s.color, (pass ? 0.55 : 0.2) * k);
        g.beginPath();
        const rIn = pass ? s.r1 * 0.88 : s.r0;
        for (let n = 0; n <= steps; n++) {
          const a = s.a0 + (s.a1 - s.a0) * (n / steps) * (1 - k * 0.0);
          const px = s.x + s.facing * Math.sin(a) * s.r1;
          const py = s.y + Math.cos(a) * s.r1;
          if (n === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        for (let n = steps; n >= 0; n--) {
          const a = s.a0 + (s.a1 - s.a0) * (n / steps);
          g.lineTo(s.x + s.facing * Math.sin(a) * rIn, s.y + Math.cos(a) * rIn);
        }
        g.closePath();
        g.fillPath();
      }
    }
  }

  get hasSlow() {
    return this.slowTarget !== 1 && this.slowT > 0;
  }

  destroy() {
    [this.sparkR, this.sparkL, this.sparkAmber, this.sparkRed, this.sparkViolet, this.dustE, this.smokeE, this.smokeViolet, this.emberE].forEach((e) => e.destroy());
    this.rings.forEach((r) => r.destroy());
    this.slashG.destroy();
  }
}
