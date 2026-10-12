import Phaser from 'phaser';
import { PAL } from '../config/gameConfig';
import type { Theme } from './Backdrop';
import type { InteractDef, PropDef, SolidDef } from '../data/types';
import { rng } from '../utils/math';

/**
 * Procedural art for level geometry and props. Solids are drawn once into their own Graphics in
 * local coordinates (origin = top-left of the collision rect) so moving platforms just move it.
 */
interface Palette { body: number; mid: number; rim: number; line: number; accent: number; moss: number }

const PALETTES: Record<Theme, Palette> = {
  fortress: { body: 0x070b12, mid: 0x0f1622, rim: 0x6f86a8, line: 0x1c2638, accent: 0xe0a040, moss: 0x14202c },
  forest: { body: 0x060c0b, mid: 0x0d1a17, rim: 0x6fa08a, line: 0x182a25, accent: 0xe0a040, moss: 0x2c4a3c },
  village: { body: 0x070d11, mid: 0x101c22, rim: 0x7fa0a8, line: 0x1a2a32, accent: 0xe0a040, moss: 0x233b3a },
  sanctum: { body: 0x080504, mid: 0x15100b, rim: 0xb08850, line: 0x2a1d12, accent: 0xe0a040, moss: 0x3a2a14 },
};

export function paletteFor(theme: Theme) {
  return PALETTES[theme];
}

const VIS_DEPTH = 420; // thick blocks only draw this much below the top

export function drawSolid(g: Phaser.GameObjects.Graphics, d: SolidDef, theme: Theme, seed: number) {
  const P = PALETTES[theme];
  const r = rng(seed);
  const w = d.w;
  const h = Math.min(d.h, VIS_DEPTH);
  const style = d.style ?? 'roof';
  g.clear();

  const rim = (x0: number, x1: number, y = 0, a = 0.9) => {
    g.lineStyle(2, P.rim, a);
    g.beginPath();
    g.moveTo(x0, y + 1);
    g.lineTo(x1, y + 1);
    g.strokePath();
    g.lineStyle(1, P.rim, a * 0.35);
    g.beginPath();
    g.moveTo(x0, y + 4);
    g.lineTo(x1, y + 4);
    g.strokePath();
  };
  const body = (col: number, a = 1) => {
    g.fillStyle(col, a);
    g.fillRect(0, 0, w, h);
  };
  const fadeBottom = () => {
    if (d.h <= VIS_DEPTH) return;
    for (let i = 0; i < 8; i++) {
      g.fillStyle(0x000000, 0.12);
      g.fillRect(0, h - 60 + i * 8, w, 8);
    }
  };

  switch (style) {
    case 'roof': {
      body(P.body);
      // Tiled roof surface: stacked rows of arcs.
      g.fillStyle(P.mid, 1);
      g.fillRect(0, 0, w, 16);
      g.lineStyle(1, P.line, 0.9);
      for (let row = 0; row < 7; row++) {
        const y = 10 + row * 18;
        const off = row % 2 ? 9 : 0;
        for (let x = -off; x < w; x += 18) {
          g.beginPath();
          g.arc(x + 9, y, 9, 0, Math.PI, false);
          g.strokePath();
        }
      }
      // Curled eaves at both ends.
      for (const sx of [0, w]) {
        const dir = sx === 0 ? -1 : 1;
        g.fillStyle(P.body, 1);
        g.fillTriangle(sx, 0, sx + dir * 14, -6, sx, 10);
        g.fillTriangle(sx, 0, sx + dir * 20, -2, sx + dir * 12, 8);
      }
      // Ridge finials.
      if (w > 200) {
        for (let x = 60; x < w - 40; x += 160 + r() * 120) {
          g.fillStyle(P.body, 1);
          g.fillRect(x, -9, 3, 10);
          g.fillCircle(x + 1.5, -10, 3);
        }
      }
      rim(0, w);
      fadeBottom();
      break;
    }
    case 'ground':
    case 'ruin':
    case 'stone': {
      body(P.body);
      // Paving courses.
      g.lineStyle(1, P.line, 0.9);
      for (let y = 16; y < h; y += 26) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.strokePath();
        const off = (Math.floor(y / 26) % 2) * 22;
        for (let x = off; x < w; x += 44 + r() * 14) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, Math.min(h, y + 26));
          g.strokePath();
        }
      }
      g.fillStyle(P.mid, 1);
      g.fillRect(0, 0, w, 10);
      // Moss / damp tufts on top.
      if (style !== 'stone' || theme !== 'sanctum') {
        g.fillStyle(P.moss, 0.9);
        for (let x = 0; x < w; x += 8 + r() * 14) {
          const mh = 2 + r() * 5;
          g.fillTriangle(x, 1, x + 5, 1, x + 2.5, -mh);
        }
      }
      if (theme === 'sanctum') {
        // carved glyph strip
        g.lineStyle(1.5, P.accent, 0.22);
        g.beginPath();
        g.moveTo(0, 24);
        g.lineTo(w, 24);
        g.strokePath();
        for (let x = 12; x < w - 12; x += 38) {
          g.strokeRect(x, 17, 10, 14);
          g.beginPath();
          g.moveTo(x + 2, 24);
          g.lineTo(x + 8, 24);
          g.strokePath();
        }
      }
      rim(0, w);
      fadeBottom();
      break;
    }
    case 'wall': {
      body(P.body);
      g.lineStyle(1, P.line, 0.9);
      for (let y = 14; y < h; y += 18) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.strokePath();
        const off = (Math.floor(y / 18) % 2) * 10;
        for (let x = off; x < w; x += 22) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y + 18);
          g.strokePath();
        }
      }
      g.fillStyle(P.mid, 1);
      g.fillRect(0, 0, w, 8);
      g.lineStyle(2, P.rim, 0.7);
      g.beginPath();
      g.moveTo(0, 1);
      g.lineTo(w, 1);
      g.moveTo(1, 0);
      g.lineTo(1, h);
      g.moveTo(w - 1, 0);
      g.lineTo(w - 1, h);
      g.strokePath();
      break;
    }
    case 'pillar': {
      body(P.body);
      rim(0, w);
      break;
    }
    case 'crate': {
      body(P.mid);
      g.lineStyle(2, P.rim, 0.55);
      g.strokeRect(1, 1, w - 2, h - 2);
      g.lineStyle(1.5, P.line, 1);
      g.beginPath();
      g.moveTo(3, 3);
      g.lineTo(w - 3, h - 3);
      g.moveTo(w - 3, 3);
      g.lineTo(3, h - 3);
      g.strokePath();
      rim(0, w, 0, 0.9);
      break;
    }
    case 'wood': {
      body(P.mid);
      g.lineStyle(1, P.line, 1);
      for (let x = 0; x < w; x += 14) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.strokePath();
      }
      g.lineStyle(2, P.rim, 0.5);
      g.strokeRect(1, 1, w - 2, h - 2);
      rim(0, w);
      break;
    }
    case 'beam': {
      body(P.body);
      g.fillStyle(P.mid, 1);
      g.fillRect(0, h - 22, w, 22);
      g.lineStyle(1.5, P.line, 1);
      for (let x = 10; x < w; x += 26) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x - 12, h);
        g.strokePath();
      }
      // iron bands + hazard edge
      g.fillStyle(P.line, 1);
      g.fillRect(0, h - 28, w, 4);
      g.lineStyle(2, P.accent, 0.55);
      g.beginPath();
      g.moveTo(0, h - 1);
      g.lineTo(w, h - 1);
      g.strokePath();
      rim(0, w, 0, 0.5);
      // chains up
      g.lineStyle(2, P.line, 1);
      for (const cx of [12, w - 12]) {
        g.beginPath();
        g.moveTo(cx, -60);
        g.lineTo(cx, 0);
        g.strokePath();
      }
      break;
    }
    case 'ledge': {
      g.fillStyle(P.mid, 1);
      g.fillRect(0, 0, w, 9);
      g.fillStyle(P.body, 1);
      g.fillRect(0, 9, w, 5);
      g.lineStyle(1, P.line, 1);
      for (let x = 8; x < w; x += 16) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, 9);
        g.strokePath();
      }
      rim(0, w, 0, 0.9);
      // supports
      g.lineStyle(2, P.line, 1);
      for (const sx of [10, w - 10]) {
        g.beginPath();
        g.moveTo(sx, 14);
        g.lineTo(sx + (sx < w / 2 ? -8 : 8), 34);
        g.strokePath();
      }
      break;
    }
    case 'gate': {
      body(P.mid);
      g.lineStyle(2, P.rim, 0.8);
      g.strokeRect(1, 1, w - 2, h - 2);
      g.lineStyle(2, P.accent, 0.6);
      for (let y = 18; y < h - 10; y += 34) {
        g.beginPath();
        g.moveTo(5, y);
        g.lineTo(w - 5, y);
        g.strokePath();
        g.strokeCircle(w / 2, y + 12, 5);
      }
      break;
    }
    case 'water': {
      g.fillStyle(0x1a2f3a, 0.6);
      g.fillRect(0, 0, w, h);
      break;
    }
    default:
      body(P.body);
      rim(0, w);
  }

  // Kind overlays.
  if (d.kind === 'crumble') {
    g.lineStyle(1.5, PAL.obsidian, 0.9);
    g.beginPath();
    g.moveTo(w * 0.3, 0);
    g.lineTo(w * 0.4, 12);
    g.lineTo(w * 0.28, 26);
    g.moveTo(w * 0.7, 0);
    g.lineTo(w * 0.62, 10);
    g.lineTo(w * 0.74, 26);
    g.strokePath();
  } else if (d.kind === 'moving') {
    g.fillStyle(P.accent, 0.5);
    g.fillRect(6, h - 5, w - 12, 2);
  }
}

export function drawShadowBridge(g: Phaser.GameObjects.Graphics, w: number) {
  g.clear();
  g.fillStyle(PAL.shadow, 0.22);
  g.fillRect(-4, -6, w + 8, 26);
  g.fillStyle(PAL.shadow, 0.6);
  g.fillRect(0, 0, w, 9);
  g.lineStyle(2.5, 0xd8ccff, 1);
  g.beginPath();
  g.moveTo(0, 1);
  g.lineTo(w, 1);
  g.strokePath();
  g.lineStyle(1, 0xc4b2ff, 0.4);
  for (let x = 6; x < w; x += 14) {
    g.beginPath();
    g.moveTo(x, 6);
    g.lineTo(x - 3, 16);
    g.strokePath();
  }
}

// ---------------------------------------------------------------------------- props
export interface PropView {
  g: Phaser.GameObjects.Graphics;
  glow?: Phaser.GameObjects.Image;
  x: number;
  w: number; // cull width
  base: number;
  seed: number;
  kind: string;
}

export function makeProp(scene: Phaser.Scene, d: PropDef, theme: Theme, seed: number): PropView {
  const P = PALETTES[theme];
  const g = scene.add.graphics().setDepth(2);
  g.setPosition(d.x, d.y);
  const s = d.s ?? 1;
  let glow: Phaser.GameObjects.Image | undefined;
  let w = 60;
  const lamp = (lx: number, ly: number, size = 1) => {
    glow = scene.add.image(d.x + lx, d.y + ly, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xe0a040).setAlpha(0.6).setScale(2.6 * size).setDepth(3);
  };
  switch (d.type) {
    case 'shade': {
      // Dark interior wash (e.g. a cellar) drawn behind the solids.
      g.setDepth(0.5);
      g.fillStyle(0x02040a, 0.9);
      g.fillRect(0, 0, d.w ?? 100, d.h ?? 100);
      w = d.w ?? 100;
      break;
    }
    case 'lamp': {
      g.fillStyle(P.body, 1);
      g.fillRect(-2, -92, 4, 92);
      g.fillRect(-2, -92, 22, 3);
      g.fillRect(14, -92, 3, 12);
      g.fillStyle(P.mid, 1);
      g.fillRect(9, -80, 15, 16);
      g.fillStyle(PAL.amberHot, 0.95);
      g.fillRect(12, -77, 9, 10);
      g.lineStyle(1.5, P.rim, 0.5);
      g.strokeRect(9, -80, 15, 16);
      lamp(16, -72);
      break;
    }
    case 'brazier': {
      g.fillStyle(P.body, 1);
      g.fillRect(-3, -40, 6, 40);
      g.fillTriangle(-16, -44, 16, -44, 0, -30);
      g.fillRect(-18, -50, 36, 8);
      g.fillStyle(PAL.amber, 1);
      g.fillTriangle(-9, -50, 9, -50, 0, -74);
      g.fillStyle(PAL.amberHot, 1);
      g.fillTriangle(-4, -50, 4, -50, 0, -64);
      lamp(0, -56, 1.3);
      break;
    }
    case 'banner': {
      g.fillStyle(P.body, 1);
      g.fillRect(-2, -130, 4, 130);
      g.fillRect(-2, -130, 34, 3);
      g.fillStyle(PAL.crimson, 0.85);
      g.fillTriangle(2, -126, 30, -126, 30, -66);
      g.fillTriangle(2, -126, 30, -66, 2, -86);
      g.fillStyle(PAL.amber, 0.7);
      g.fillCircle(16, -104, 4);
      break;
    }
    case 'statue': {
      g.fillStyle(P.mid, 1);
      g.fillRect(-18, -12, 36, 12);
      g.fillStyle(P.body, 1);
      g.fillRect(-9, -52, 18, 40);
      g.fillCircle(0, -58, 8);
      g.fillTriangle(-9, -52, -24, -20, -9, -20);
      g.fillTriangle(9, -52, 24, -20, 9, -20);
      g.lineStyle(1.5, P.rim, 0.45);
      g.strokeCircle(0, -58, 8);
      break;
    }
    case 'torii': {
      g.fillStyle(P.body, 1);
      g.fillRect(-60, -160, 14, 160);
      g.fillRect(46, -160, 14, 160);
      g.fillRect(-76, -172, 152, 12);
      g.fillTriangle(-84, -172, -60, -172, -70, -184);
      g.fillTriangle(84, -172, 60, -172, 70, -184);
      g.fillRect(-60, -136, 120, 8);
      g.lineStyle(2, PAL.amber, 0.5);
      g.strokeRect(-76, -172, 152, 12);
      w = 220;
      break;
    }
    case 'chain': {
      const len = 120 * s;
      g.lineStyle(2, P.line, 1);
      for (let y = -len; y < 0; y += 12) {
        g.strokeEllipse(0, y, 5, 9);
      }
      w = 30;
      break;
    }
    case 'bush': {
      g.fillStyle(P.moss, 1);
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI * (0.1 + i * 0.13);
        g.fillTriangle(0, 0, Math.cos(a) * 34 - 4, Math.sin(a) * 34, Math.cos(a) * 34 + 4, Math.sin(a) * 34);
      }
      g.fillStyle(P.body, 1);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI * (0.18 + i * 0.16);
        g.fillTriangle(0, 0, Math.cos(a) * 24 - 3, Math.sin(a) * 24, Math.cos(a) * 24 + 3, Math.sin(a) * 24);
      }
      break;
    }
    case 'glyph': {
      g.lineStyle(2, P.accent, 0.5);
      g.strokeCircle(0, -80, 26);
      g.strokeCircle(0, -80, 14);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * 14, -80 + Math.sin(a) * 14);
        g.lineTo(Math.cos(a) * 26, -80 + Math.sin(a) * 26);
        g.strokePath();
      }
      glow = scene.add.image(d.x, d.y - 80, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xe0a040).setAlpha(0.3).setScale(2.2).setDepth(3);
      break;
    }
    case 'pole': {
      g.fillStyle(P.body, 1);
      g.fillRect(-2, -110, 4, 110);
      g.lineStyle(1.5, P.line, 1);
      g.beginPath();
      g.moveTo(2, -108);
      g.lineTo(46, -80);
      g.strokePath();
      break;
    }
    default:
      break;
  }
  void seed;
  return { g, glow, x: d.x, w, base: 0.4 + (seed % 7) * 0.08, seed, kind: d.type };
}

// -------------------------------------------------------------------- interactables
export interface InteractView {
  def: InteractDef;
  g: Phaser.GameObjects.Graphics;
  glow: Phaser.GameObjects.Image;
  lit: boolean;
  used: boolean;
}

export function drawInteract(v: InteractView, theme: Theme) {
  const P = PALETTES[theme];
  const g = v.g;
  g.clear();
  const d = v.def;
  switch (d.type) {
    case 'rest': {
      g.fillStyle(P.mid, 1);
      g.fillRect(-14, -14, 28, 14);
      g.fillStyle(P.body, 1);
      g.fillRect(-7, -48, 14, 34);
      g.fillRect(-16, -54, 32, 8);
      g.lineStyle(1.5, P.rim, 0.6);
      g.strokeRect(-16, -54, 32, 8);
      const a = v.used ? 0.35 : 1;
      g.fillStyle(PAL.amber, a);
      g.fillTriangle(-8, -54, 8, -54, 0, -78);
      g.fillStyle(PAL.amberHot, a);
      g.fillTriangle(-4, -54, 4, -54, 0, -68);
      v.glow.setPosition(d.x, d.y - 62).setTint(0xe0a040).setScale(v.used ? 2 : 4).setAlpha(0.7);
      break;
    }
    case 'lore': {
      g.fillStyle(P.mid, 1);
      g.fillRect(-14, -50, 28, 50);
      g.fillCircle(0, -50, 14);
      g.lineStyle(1.5, v.used ? P.rim : PAL.amber, v.used ? 0.4 : 0.85);
      g.strokeCircle(0, -48, 6);
      g.beginPath();
      g.moveTo(-6, -32);
      g.lineTo(6, -32);
      g.moveTo(-6, -24);
      g.lineTo(6, -24);
      g.strokePath();
      v.glow.setPosition(d.x, d.y - 40).setTint(0xe0a040).setScale(v.used ? 0.6 : 1.8).setAlpha(v.used ? 0.1 : 0.4);
      break;
    }
    case 'pickupBlade': {
      if (v.used) {
        v.glow.setAlpha(0);
        break;
      }
      // fallen guard
      g.fillStyle(P.body, 1);
      g.fillRect(-26, -12, 54, 12);
      g.fillCircle(-28, -10, 8);
      g.fillTriangle(10, -12, 34, -2, 10, 0);
      g.lineStyle(3, 0xcfe0f2, 0.9);
      g.beginPath();
      g.moveTo(-6, -18);
      g.lineTo(34, -34);
      g.strokePath();
      g.lineStyle(3, P.body, 1);
      g.beginPath();
      g.moveTo(-14, -15);
      g.lineTo(-6, -18);
      g.strokePath();
      v.glow.setPosition(d.x + 16, d.y - 26).setTint(0xcfe0f2).setScale(2.4).setAlpha(0.6);
      break;
    }
    case 'altarShadow': {
      g.fillStyle(P.mid, 1);
      g.fillRect(-26, -16, 52, 16);
      g.fillStyle(P.body, 1);
      g.fillRect(-18, -34, 36, 18);
      g.lineStyle(2, v.used ? PAL.shadow : PAL.amber, 0.9);
      g.strokeCircle(0, -52, 14);
      g.strokeCircle(0, -52, 7);
      g.beginPath();
      g.moveTo(-14, -52);
      g.lineTo(14, -52);
      g.moveTo(0, -66);
      g.lineTo(0, -38);
      g.strokePath();
      v.glow.setPosition(d.x, d.y - 52).setTint(v.used ? PAL.shadow : 0xe0a040).setScale(3).setAlpha(0.6);
      break;
    }
    case 'lamp': {
      g.fillStyle(P.mid, 1);
      g.fillRect(-10, -14, 20, 14);
      g.fillStyle(P.body, 1);
      g.fillRect(-5, -28, 10, 14);
      g.fillTriangle(-9, -28, 9, -28, 0, -36);
      if (v.lit) {
        g.fillStyle(PAL.amber, 1);
        g.fillTriangle(-5, -36, 5, -36, 0, -56);
        g.fillStyle(PAL.amberHot, 1);
        g.fillTriangle(-2.5, -36, 2.5, -36, 0, -48);
      } else {
        g.fillStyle(0x50301a, 1);
        g.fillCircle(0, -36, 2);
      }
      v.glow.setPosition(d.x, d.y - 44).setTint(0xe0a040).setScale(v.lit ? 4.2 : 0.8).setAlpha(v.lit ? 0.75 : 0.18);
      break;
    }
    case 'shrineGift': {
      g.fillStyle(P.mid, 1);
      g.fillRect(-40, -14, 80, 14);
      g.fillStyle(P.body, 1);
      g.fillRect(-30, -90, 12, 76);
      g.fillRect(18, -90, 12, 76);
      g.fillTriangle(-44, -90, 44, -90, 0, -122);
      g.fillStyle(P.mid, 1);
      g.fillRect(-10, -48, 20, 34);
      g.fillCircle(0, -56, 10);
      g.lineStyle(2, PAL.amber, 0.7);
      g.strokeCircle(0, -56, 16);
      v.glow.setPosition(d.x, d.y - 60).setTint(v.used ? 0x9fd8ff : 0xe0a040).setScale(5).setAlpha(0.6);
      break;
    }
    default:
      break;
  }
}
