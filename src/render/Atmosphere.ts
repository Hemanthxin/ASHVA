import Phaser from 'phaser';
import { BackdropSet, LAYER_H, Theme, buildBackdrop, ensureMoon } from './Backdrop';
import { VIEW_H } from '../config/gameConfig';
import { save } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';

interface Layer {
  ts: Phaser.GameObjects.TileSprite;
  fill: Phaser.GameObjects.Rectangle | null;
  factor: number;
  vFactor: number;
}

/**
 * Screen-space atmosphere: sky, parallax silhouettes, fog banks, rain, lightning, drifting embers,
 * vignette and Shadow-Debt tinting. Everything is built from a handful of pooled objects.
 */
export class Atmosphere {
  readonly set: BackdropSet;
  private sky: Phaser.GameObjects.Image;
  private moon: Phaser.GameObjects.Image | null = null;
  private layers: Layer[] = [];
  private fg: Phaser.GameObjects.TileSprite;
  private fogs: Array<{ img: Phaser.GameObjects.Image; base: number; speed: number; factor: number; y: number }> = [];
  private rainFar: Phaser.GameObjects.TileSprite;
  private rainNear: Phaser.GameObjects.TileSprite;
  private vignette: Phaser.GameObjects.Image;
  private vigRed: Phaser.GameObjects.Image;
  private vigViolet: Phaser.GameObjects.Image;
  private flashRect: Phaser.GameObjects.Rectangle;
  private bolt: Phaser.GameObjects.Graphics;
  private embers: Phaser.GameObjects.Particles.ParticleEmitter;
  private w: number;
  private lightningTimer = 4 + Math.random() * 6;
  private flashV = 0;
  private boltT = 0;
  private time = 0;
  private yShift = 0;
  private unsub: (() => void) | null = null;
  private rainSpeed = 1;
  readonly outdoor: boolean;

  constructor(private scene: Phaser.Scene, theme: Theme, w: number, private refY: number, rain = true, lightning = true) {
    this.w = w;
    this.set = buildBackdrop(scene, theme);
    this.outdoor = theme !== 'sanctum';
    this.lightningEnabled = lightning && this.outdoor;
    const H = VIEW_H;

    this.sky = scene.add.image(0, 0, this.set.skyKey).setOrigin(0, 0).setScrollFactor(0).setDepth(-100);
    this.sky.setDisplaySize(w, H);
    if (this.set.moon) {
      ensureMoon(scene);
      this.moon = scene.add.image(w * 0.74, H * 0.2, 'moon').setScrollFactor(0).setDepth(-99);
    }

    this.set.layers.forEach((spec, i) => {
      const ts = scene.add.tileSprite(0, H - LAYER_H, w, LAYER_H, spec.key).setOrigin(0, 0).setScrollFactor(0).setDepth(-90 + i * 8);
      const fill = scene.add.rectangle(0, H, w, 1400, spec.fill).setOrigin(0, 0).setScrollFactor(0).setDepth(-90 + i * 8);
      this.layers.push({ ts, fill, factor: spec.factor, vFactor: spec.vFactor });
      // Fog bank in front of each far layer.
      if (i < 3) {
        for (let k = 0; k < 2; k++) {
          const img = scene.add.image(0, 0, 'blob').setScrollFactor(0).setDepth(-88 + i * 8).setTint(this.set.fogColor).setAlpha(this.set.fogAlpha * (1 - i * 0.2));
          img.setScale(5 + i, 2.2 + i * 0.5);
          this.fogs.push({ img, base: Math.random() * 2000, speed: 6 + Math.random() * 10, factor: spec.factor * 1.1, y: H - 120 - i * 40 + k * 30 });
        }
      }
    });

    this.fg = scene.add.tileSprite(0, H - LAYER_H, w, LAYER_H, this.set.fg.key).setOrigin(0, 0).setScrollFactor(0).setDepth(40).setAlpha(theme === 'sanctum' ? 0.45 : 0.92);

    this.rainFar = scene.add.tileSprite(0, 0, w, H, 'rainFar').setOrigin(0, 0).setScrollFactor(0).setDepth(-5).setVisible(rain);
    this.rainNear = scene.add.tileSprite(0, 0, w, H, 'rainNear').setOrigin(0, 0).setScrollFactor(0).setDepth(60).setVisible(rain);

    this.vignette = scene.add.image(0, 0, 'vignette').setOrigin(0, 0).setScrollFactor(0).setDepth(100).setDisplaySize(w, H);
    this.vigRed = scene.add.image(0, 0, 'vignetteRed').setOrigin(0, 0).setScrollFactor(0).setDepth(101).setDisplaySize(w, H).setAlpha(0);
    this.vigViolet = scene.add.image(0, 0, 'vignetteViolet').setOrigin(0, 0).setScrollFactor(0).setDepth(101).setDisplaySize(w, H).setAlpha(0);
    this.flashRect = scene.add.rectangle(0, 0, w, H, 0xcfe0ff).setOrigin(0, 0).setScrollFactor(0).setDepth(95).setAlpha(0);
    this.bolt = scene.add.graphics().setScrollFactor(0).setDepth(-60);

    const ember = theme === 'sanctum' ? 0xe0a040 : theme === 'village' ? 0xb9d9c8 : 0x9fb6d0;
    this.embers = scene.add.particles(0, 0, 'dot', {
      x: { min: 0, max: w },
      y: { min: H * 0.3, max: H },
      lifespan: { min: 3500, max: 6500 },
      speedY: { min: -26, max: -8 },
      speedX: { min: -14, max: 14 },
      scale: { start: 0.22, end: 0 },
      alpha: { start: 0.0, end: 0.7, ease: (t: number) => Math.sin(t * Math.PI) },
      tint: ember,
      blendMode: 'ADD',
      frequency: theme === 'sanctum' ? 140 : 260,
      quantity: 1,
    });
    this.embers.setScrollFactor(0).setDepth(55);
    this.applySettings();
    this.unsub = save.onSettings(() => this.applySettings());
    this.update(0, 0, 0);
    audio.setRain(rain, theme === 'sanctum' ? 0 : 1);
  }

  private lightningEnabled: boolean;

  applySettings() {
    const reduced = save.settings.reducedFx;
    if (!this.rainFar || !this.rainFar.scene) return;
    this.rainFar.setVisible(!reduced && this.rainNear.visible);
    this.embers.setVisible(!reduced);
    this.embers.frequency = reduced ? 800 : this.set.theme === 'sanctum' ? 140 : 260;
  }

  resize(w: number) {
    this.w = w;
    const H = VIEW_H;
    this.sky.setDisplaySize(w, H);
    this.moon?.setPosition(w * 0.74, H * 0.2);
    for (const l of this.layers) {
      l.ts.setSize(w, LAYER_H);
      l.fill?.setSize(w, 1400);
    }
    this.fg.setSize(w, LAYER_H);
    this.rainFar.setSize(w, H);
    this.rainNear.setSize(w, H);
    this.vignette.setDisplaySize(w, H);
    this.vigRed.setDisplaySize(w, H);
    this.vigViolet.setDisplaySize(w, H);
    this.flashRect.setSize(w, H);
  }

  /** Camera zoom compensation: keeps layer horizons at the bottom of the visible area. */
  setZoom(z: number) {
    this.yShift = (VIEW_H / 2) * (1 - 1 / z);
  }

  setForeground(v: boolean) {
    this.fg.setVisible(v);
  }

  setRainLevel(v: number) {
    this.rainSpeed = v;
  }

  /** White flash (lightning, shadow-dash, parry). */
  flash(v: number) {
    this.flashV = Math.max(this.flashV, v);
  }

  /** debt 0..100 drives the subtle red/violet world tint. */
  setDebt(debt: number) {
    this.vigRed.setAlpha(Math.max(0, (debt - 60) / 40) * 0.8);
    this.vigViolet.setAlpha(Math.max(0, (debt - 25) / 60) * 0.6);
  }

  update(dt: number, camX: number, camY: number) {
    this.time += dt;
    const H = VIEW_H;
    for (const l of this.layers) {
      l.ts.tilePositionX = camX * l.factor;
      const y = H - LAYER_H + (this.refY - camY) * l.vFactor - this.yShift;
      l.ts.y = y;
      if (l.fill) l.fill.y = y + LAYER_H - 1;
    }
    this.fg.tilePositionX = camX * this.set.fg.factor;
    this.fg.y = H - LAYER_H + (this.refY - camY) * this.set.fg.vFactor + 40 - this.yShift;

    const reduced = save.settings.reducedFx;
    for (const f of this.fogs) {
      const span = this.w + 900;
      const x = (((f.base + this.time * f.speed - camX * f.factor) % span) + span) % span - 450;
      f.img.x = x;
      f.img.y = f.y + (this.refY - camY) * 0.1 - this.yShift;
      f.img.visible = !reduced;
    }
    this.rainNear.tilePositionY -= 880 * dt * this.rainSpeed;
    this.rainNear.tilePositionX = camX * 0.9 - this.time * 80;
    this.rainFar.tilePositionY -= 520 * dt * this.rainSpeed;
    this.rainFar.tilePositionX = camX * 0.5 - this.time * 45;

    // Lightning.
    if (this.lightningEnabled) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 7 + Math.random() * 13;
        this.strike();
      }
    }
    if (this.flashV > 0.001) {
      this.flashRect.setAlpha(this.flashV * (reduced ? 0.4 : 1));
      this.flashV = Math.max(0, this.flashV - dt * 2.4);
    } else if (this.flashRect.alpha > 0) {
      this.flashRect.setAlpha(0);
    }
    if (this.boltT > 0) {
      this.boltT -= dt;
      if (this.boltT <= 0) this.bolt.clear();
    }
  }

  strike() {
    this.flash(0.5);
    this.scene.time.delayedCall(110, () => this.flash(0.35));
    this.drawBolt();
    audio.thunder(0.3 + Math.random() * 1.2);
  }

  private drawBolt() {
    const g = this.bolt;
    g.clear();
    let x = 80 + Math.random() * (this.w - 160);
    let y = 0;
    const pts: Array<[number, number]> = [[x, y]];
    while (y < VIEW_H * 0.55) {
      x += (Math.random() - 0.5) * 50;
      y += 20 + Math.random() * 30;
      pts.push([x, y]);
    }
    for (const [w, a] of [[7, 0.14], [3, 0.35], [1.4, 0.95]] as const) {
      g.lineStyle(w, 0xdfeaff, a);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.strokePath();
    }
    this.boltT = 0.18;
  }

  destroy() {
    this.unsub?.();
    this.sky.destroy();
    this.moon?.destroy();
    this.layers.forEach((l) => {
      l.ts.destroy();
      l.fill?.destroy();
    });
    this.fogs.forEach((f) => f.img.destroy());
    [this.fg, this.rainFar, this.rainNear, this.vignette, this.vigRed, this.vigViolet, this.flashRect, this.bolt, this.embers].forEach((o) => o.destroy());
    audio.setRain(false);
  }
}
