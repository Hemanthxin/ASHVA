import Phaser from 'phaser';
import { PAL, VIEW_H } from '../config/gameConfig';
import { Atmosphere } from '../render/Atmosphere';
import { ARU_STYLE, Cloth, Pose, drawRig, jointWorld, neutralPose } from '../render/Silhouette';
import { audio } from '../systems/AudioSystem';
import { save } from '../systems/SaveSystem';
import { menus } from '../ui/Menus';
import { hud } from '../ui/HUD';
import { touch } from '../ui/TouchControls';
import { flow } from '../core/flow';
import { getLevel } from '../data/levels';
import { ensureTextures } from '../utils/assetFallbacks';

/** Title screen: Aru on a ruined rooftop under a storm moon, DOM menu on top. */
export class MenuScene extends Phaser.Scene {
  private atmos!: Atmosphere;
  private g!: Phaser.GameObjects.Graphics;
  private cloth = new Cloth(10, 5.4);
  private t = 0;
  private w = 960;
  private onResize = () => {
    this.w = this.scale.width;
    this.atmos.resize(this.w);
  };

  constructor() {
    super('Menu');
  }

  create() {
    ensureTextures(this);
    this.t = 0;
    this.w = this.scale.width;
    this.cameras.main.setBackgroundColor('#05070b');
    this.atmos = new Atmosphere(this, 'fortress', this.w, 300, true, true);
    this.atmos.setForeground(false);
    this.g = this.add.graphics().setDepth(10);
    this.cloth.reset(this.w * 0.8, 340);

    hud.hide();
    touch.setActive(false);
    hud.fadeNow(true);
    this.time.delayedCall(80, () => hud.fade(false, 1400));

    audio.setMood('calm');
    this.scale.on('resize', this.onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize);
      this.atmos.destroy();
    });
    this.showMenu();
  }

  private showMenu() {
    const sv = save.hasSave() ? save.get() : null;
    let label: string | undefined;
    if (sv) {
      const lv = getLevel(sv.levelId);
      label = `Ch. ${lv.chapter}`;
    }
    menus.showMain({
      hasSave: !!sv,
      chapterLabel: label,
      onNew: () => flow.startNew(),
      onContinue: () => flow.continueGame(),
      onIntro: () => flow.playIntro('menu'),
    });
  }

  update(_t: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.05);
    this.t += dt;
    // Slow drifting camera across the parallax layers.
    this.atmos.update(dt, this.t * 14, 300);
    const g = this.g;
    g.clear();
    const W = this.w;
    const gy = 392;
    const px = W * 0.76;
    // Foreground roof ridge (right) and a distant broken roofline (left).
    g.fillStyle(PAL.obsidian, 1);
    g.fillRect(W * 0.58, gy, W, VIEW_H);
    g.fillTriangle(W * 0.58 - 26, gy - 10, W * 0.58, gy - 10, W * 0.58, gy + 6);
    g.lineStyle(2, 0x6f86a8, 0.8);
    g.beginPath();
    g.moveTo(W * 0.58 - 24, gy - 9);
    g.lineTo(W * 0.58, gy - 1);
    g.lineTo(W, gy + 1);
    g.strokePath();
    g.fillStyle(PAL.obsidian, 1);
    g.fillRect(0, gy + 80, W * 0.34, VIEW_H);
    g.fillTriangle(0, gy + 80, W * 0.34, gy + 80, W * 0.34, gy + 60);
    // Finial post
    g.fillRect(W * 0.9, gy - 60, 4, 60);
    g.fillCircle(W * 0.9 + 2, gy - 62, 5);

    // Aru: a still silhouette with a streaming scarf, blade low.
    const breathe = Math.sin(this.t * 1.6) * 0.02;
    const pose: Pose = neutralPose();
    pose.lean = 0.1 + breathe;
    pose.legF = [0.35, 0.2];
    pose.legB = [-0.3, 0.15];
    pose.armF = [0.6, 0.7];
    pose.armB = [-0.2, 0.5];
    pose.weapon = 1.2;
    pose.head = -0.08 + Math.sin(this.t * 0.7) * 0.03;
    const style = { ...ARU_STYLE, scale: 1.7 };
    const neck = jointWorld('neck', pose, style, px, gy, -1);
    this.cloth.update(neck.x, neck.y, 1, dt, this.t);
    // wind: nudge cloth
    for (let i = 1; i < this.cloth.pts.length; i++) this.cloth.pts[i].x += Math.sin(this.t * 3 + i) * 0.4 + 0.9;
    drawRig(g, px, gy, -1, pose, style, { scarf: this.cloth.pts, rimAlpha: 0.7, weaponGlow: 0.4 });
  }
}
