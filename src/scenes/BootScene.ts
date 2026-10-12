import Phaser from 'phaser';
import { ensureTextures } from '../utils/assetFallbacks';

/** Generates all shared textures in code (no external assets), then opens the menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }
  create() {
    ensureTextures(this);
    this.scene.start('Menu');
  }
}
