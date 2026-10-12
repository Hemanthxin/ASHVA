import Phaser from 'phaser';
import { rng } from '../utils/math';

export type Theme = 'fortress' | 'forest' | 'village' | 'sanctum';

export interface LayerSpec {
  key: string;
  fill: number; // colour of the layer's bottom edge (used to extend it downward)
  factor: number; // horizontal parallax factor
  vFactor: number; // vertical parallax factor
}
export interface BackdropSet {
  theme: Theme;
  skyKey: string;
  layers: LayerSpec[]; // far -> near
  fg: LayerSpec;
  fogColor: number;
  fogAlpha: number;
  glow: number; // ambient colour used for light halos
  moon: boolean;
}

const W = 1024;
const H = 512;
type Ctx = CanvasRenderingContext2D;
type Rand = () => number;

const wrap = (ctx: Ctx, x: number, ext: number, fn: (x: number) => void) => {
  fn(x);
  if (x - ext < 0) fn(x + W);
  if (x + ext > W) fn(x - W);
};

// ---------------------------------------------------------------- primitives
function shikhara(c: Ctx, cx: number, by: number, w: number, h: number) {
  c.beginPath();
  c.moveTo(cx - w / 2, by);
  c.lineTo(cx - w / 2, by - h * 0.22);
  c.bezierCurveTo(cx - w * 0.52, by - h * 0.55, cx - w * 0.28, by - h * 0.84, cx, by - h);
  c.bezierCurveTo(cx + w * 0.28, by - h * 0.84, cx + w * 0.52, by - h * 0.55, cx + w / 2, by - h * 0.22);
  c.lineTo(cx + w / 2, by);
  c.closePath();
  c.fill();
  c.fillRect(cx - w * 0.17, by - h * 0.86, w * 0.34, h * 0.04);
  c.fillRect(cx - w * 0.12, by - h * 0.62, w * 0.24, h * 0.025);
  c.fillRect(cx - 1.2, by - h * 1.12, 2.4, h * 0.13);
  c.beginPath();
  c.arc(cx, by - h * 1.13, Math.max(2, w * 0.05), 0, Math.PI * 2);
  c.fill();
}

function gopuram(c: Ctx, cx: number, by: number, w: number, tiers: number, th: number) {
  let y = by;
  let cw = w;
  for (let t = 0; t < tiers; t++) {
    c.fillRect(cx - cw / 2, y - th, cw, th);
    c.fillRect(cx - cw / 2 - 5, y - th, cw + 10, 4);
    // tiny corner domes
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.ellipse(cx + sx * (cw / 2 - 4), y - th, 5, 6, 0, Math.PI, 0);
      c.fill();
    }
    y -= th;
    cw *= 0.82;
  }
  c.beginPath();
  c.ellipse(cx, y, cw / 2, th * 0.9, 0, Math.PI, 0);
  c.fill();
  for (const dx of [-0.35, 0, 0.35]) {
    c.fillRect(cx + dx * cw - 1.2, y - th * 1.45, 2.4, th * 0.55);
    c.beginPath();
    c.arc(cx + dx * cw, y - th * 1.5, 3, 0, Math.PI * 2);
    c.fill();
  }
}

function dome(c: Ctx, cx: number, by: number, r: number) {
  c.fillRect(cx - r * 0.8, by - r * 0.3, r * 1.6, r * 0.3);
  c.beginPath();
  c.ellipse(cx, by - r * 0.3, r, r * 0.95, 0, Math.PI, 0);
  c.fill();
  c.fillRect(cx - 1.2, by - r * 1.65, 2.4, r * 0.4);
  c.beginPath();
  c.arc(cx, by - r * 1.7, 2.5, 0, Math.PI * 2);
  c.fill();
}

function chhatri(c: Ctx, cx: number, by: number, w: number, h: number) {
  for (const dx of [-0.45, -0.15, 0.15, 0.45]) c.fillRect(cx + dx * w - 1.5, by - h, 3, h);
  c.fillRect(cx - w / 2 - 3, by - h - 3, w + 6, 4);
  c.beginPath();
  c.ellipse(cx, by - h - 3, w * 0.42, w * 0.32, 0, Math.PI, 0);
  c.fill();
  c.fillRect(cx - 1, by - h - 3 - w * 0.5, 2, w * 0.2);
}

function crenellations(c: Ctx, x0: number, x1: number, by: number, h: number, mw: number) {
  c.fillRect(x0, by - h, x1 - x0, h);
  for (let x = x0; x < x1; x += mw * 2) c.fillRect(x, by - h - mw * 0.9, mw, mw * 0.9);
}

function column(c: Ctx, x: number, by: number, w: number, h: number) {
  c.fillRect(x - w / 2, by - h, w, h);
  c.fillRect(x - w * 0.72, by - h, w * 1.44, h * 0.05);
  c.fillRect(x - w * 0.72, by - h * 0.05, w * 1.44, h * 0.05);
}

function arch(c: Ctx, x: number, by: number, w: number, h: number, thick: number) {
  c.fillRect(x - w / 2 - thick, by - h, thick, h);
  c.fillRect(x + w / 2, by - h, thick, h);
  c.beginPath();
  c.ellipse(x, by - h, w / 2 + thick, w * 0.5 + thick, 0, Math.PI, 0);
  c.ellipse(x, by - h, w / 2, w * 0.5, 0, 0, Math.PI, true);
  c.fill('evenodd');
}

function tree(c: Ctx, r: Rand, x: number, by: number, h: number, w: number, canopy: number) {
  c.beginPath();
  c.moveTo(x - w * 0.5, by);
  c.quadraticCurveTo(x - w * 0.2, by - h * 0.5, x - w * 0.28, by - h);
  c.lineTo(x + w * 0.28, by - h);
  c.quadraticCurveTo(x + w * 0.2, by - h * 0.5, x + w * 0.5, by);
  c.closePath();
  c.fill();
  // roots
  c.beginPath();
  c.moveTo(x - w * 0.5, by);
  c.quadraticCurveTo(x - w * 1.2, by, x - w * 1.6, by + 4);
  c.lineTo(x - w * 0.3, by - 12);
  c.fill();
  c.beginPath();
  c.moveTo(x + w * 0.5, by);
  c.quadraticCurveTo(x + w * 1.2, by, x + w * 1.6, by + 4);
  c.lineTo(x + w * 0.3, by - 12);
  c.fill();
  // branches + canopy blobs
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const y0 = by - h * (0.55 + r() * 0.4);
    const len = w * (2 + r() * 3);
    c.lineWidth = Math.max(2, w * 0.18);
    c.strokeStyle = c.fillStyle as string;
    c.beginPath();
    c.moveTo(x, y0);
    c.quadraticCurveTo(x + side * len * 0.5, y0 - len * 0.2, x + side * len, y0 - len * 0.1 + r() * 10);
    c.stroke();
  }
  for (let i = 0; i < canopy; i++) {
    const cx = x + (r() - 0.5) * w * 7;
    const cy = by - h + (r() - 0.6) * h * 0.18;
    c.beginPath();
    c.ellipse(cx, cy, w * (1.2 + r() * 1.6), w * (0.7 + r() * 0.9), 0, 0, Math.PI * 2);
    c.fill();
  }
}

function vine(c: Ctx, r: Rand, x: number, topY: number, len: number) {
  c.lineWidth = 1.6;
  c.strokeStyle = c.fillStyle as string;
  c.beginPath();
  c.moveTo(x, topY);
  c.bezierCurveTo(x + (r() - 0.5) * 16, topY + len * 0.3, x + (r() - 0.5) * 16, topY + len * 0.7, x + (r() - 0.5) * 8, topY + len);
  c.stroke();
  for (let i = 0; i < 4; i++) {
    const yy = topY + len * (0.4 + i * 0.15);
    c.beginPath();
    c.ellipse(x + (r() - 0.5) * 6, yy, 2.5, 5, r(), 0, Math.PI * 2);
    c.fill();
  }
}

function stalactite(c: Ctx, x: number, topY: number, w: number, h: number) {
  c.beginPath();
  c.moveTo(x - w / 2, topY);
  c.quadraticCurveTo(x - w * 0.15, topY + h * 0.6, x, topY + h);
  c.quadraticCurveTo(x + w * 0.15, topY + h * 0.6, x + w / 2, topY);
  c.closePath();
  c.fill();
}
function stalagmite(c: Ctx, x: number, by: number, w: number, h: number) {
  c.beginPath();
  c.moveTo(x - w / 2, by);
  c.quadraticCurveTo(x - w * 0.12, by - h * 0.6, x, by - h);
  c.quadraticCurveTo(x + w * 0.12, by - h * 0.6, x + w / 2, by);
  c.closePath();
  c.fill();
}

function stiltHut(c: Ctx, x: number, by: number, w: number) {
  const ph = 26;
  c.fillRect(x - w * 0.4, by - ph, 3, ph);
  c.fillRect(x + w * 0.4 - 3, by - ph, 3, ph);
  c.fillRect(x - w * 0.5, by - ph - 4, w, 5);
  c.fillRect(x - w * 0.4, by - ph - 26, w * 0.8, 22);
  c.beginPath();
  c.moveTo(x - w * 0.62, by - ph - 24);
  c.lineTo(x, by - ph - 54);
  c.lineTo(x + w * 0.62, by - ph - 24);
  c.closePath();
  c.fill();
}

function palm(c: Ctx, r: Rand, x: number, by: number, h: number) {
  c.lineWidth = 3;
  c.strokeStyle = c.fillStyle as string;
  c.beginPath();
  c.moveTo(x, by);
  c.quadraticCurveTo(x + (r() - 0.5) * 30, by - h * 0.5, x + (r() - 0.5) * 20, by - h);
  c.stroke();
  const tx = x + (r() - 0.5) * 20;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * (0.05 + (i / 6) * 0.9);
    const l = 30 + r() * 20;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(tx, by - h);
    c.quadraticCurveTo(tx + Math.cos(a) * l * 0.6, by - h + Math.sin(a) * l * 0.6 - 6, tx + Math.cos(a) * l, by - h + Math.sin(a) * l + 12);
    c.stroke();
  }
}

function windowsDots(c: Ctx, r: Rand, x0: number, x1: number, y0: number, y1: number, n: number, color: string) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = color;
    c.globalAlpha = 0.25 + r() * 0.6;
    c.fillRect(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), 2 + r() * 2, 3 + r() * 3);
  }
  c.globalAlpha = 1;
}

function ridge(c: Ctx, r: Rand, baseY: number, amp: number, step: number) {
  c.beginPath();
  c.moveTo(0, H);
  let y = baseY;
  for (let x = 0; x <= W; x += step) {
    y = baseY - Math.abs(Math.sin(x * 0.011 + 1.3) * amp) - r() * amp * 0.35;
    c.lineTo(x, y);
  }
  c.lineTo(W, baseY - Math.abs(Math.sin(1.3)) * amp);
  c.lineTo(W, H);
  c.closePath();
  c.fill();
}

// --------------------------------------------------------------------- build
type LayerFn = (c: Ctx, r: Rand) => void;
interface ThemeDef {
  sky: string[]; // gradient stops top->bottom
  horizonGlow: string;
  moon: boolean;
  colors: string[]; // far->near fills (4) + fg
  fog: string; // rgb triple "r,g,b"
  fogColor: number;
  fogAlpha: number;
  glow: number;
  layers: LayerFn[]; // 4
  fg: LayerFn;
  factors: number[];
  vFactors: number[];
}

const AMBER = '#e0a040';

const THEMES: Record<Theme, ThemeDef> = {
  fortress: {
    sky: ['#05070e', '#0e1730', '#1b2c4c', '#33496b'],
    horizonGlow: 'rgba(224,160,64,0.16)',
    moon: true,
    colors: ['#1d2c47', '#15223a', '#0d1627', '#070c15', '#03060a'],
    fog: '70,100,150',
    fogColor: 0x3a5478,
    fogAlpha: 0.18,
    glow: 0xe0a040,
    factors: [0.05, 0.12, 0.26, 0.48],
    vFactors: [0.03, 0.07, 0.14, 0.25],
    layers: [
      (c, r) => {
        ridge(c, r, 420, 90, 18);
        for (let i = 0; i < 5; i++) wrap(c, 60 + i * 200 + r() * 60, 40, (x) => shikhara(c, x, 420 - 30 - r() * 20, 30, 70 + r() * 40));
        windowsDots(c, r, 0, W, 360, 420, 28, AMBER);
      },
      (c, r) => {
        for (let i = 0; i < 6; i++) {
          const x = 70 + i * 170 + r() * 50;
          wrap(c, x, 80, (xx) => {
            const t = r();
            if (t < 0.4) gopuram(c, xx, 470, 70 + r() * 30, 4 + Math.floor(r() * 2), 26);
            else if (t < 0.75) shikhara(c, xx, 470, 55 + r() * 20, 150 + r() * 80);
            else dome(c, xx, 470, 38 + r() * 14);
          });
        }
        c.fillRect(0, 470, W, 60);
        windowsDots(c, r, 0, W, 400, 468, 36, AMBER);
      },
      (c, r) => {
        crenellations(c, 0, W, 500, 90, 14);
        for (let i = 0; i < 7; i++) wrap(c, 40 + i * 150 + r() * 40, 30, (x) => chhatri(c, x, 410, 34, 34));
        for (let i = 0; i < 4; i++) wrap(c, 100 + i * 260, 40, (x) => c.fillRect(x - 18, 300, 36, 112));
        for (let i = 0; i < 4; i++) wrap(c, 100 + i * 260, 40, (x) => dome(c, x, 300, 22));
        windowsDots(c, r, 0, W, 330, 495, 34, AMBER);
      },
      (c, r) => {
        c.fillRect(0, 495, W, 30);
        for (let i = 0; i < 8; i++) {
          const x = 30 + i * 128 + r() * 40;
          const w = 70 + r() * 50;
          wrap(c, x, 90, (xx) => {
            c.beginPath();
            c.moveTo(xx - w / 2, 500);
            c.lineTo(xx - w / 2 + 6, 440);
            c.quadraticCurveTo(xx, 420 - r() * 14, xx + w / 2 - 6, 440);
            c.lineTo(xx + w / 2, 500);
            c.closePath();
            c.fill();
            // ridge finial
            c.fillRect(xx - 1.5, 410 - r() * 10, 3, 24);
          });
        }
        // hanging lanterns (glow added by overlay)
        for (let i = 0; i < 6; i++) {
          const x = 60 + i * 170;
          c.fillRect(x, 0, 1.5, 70 + r() * 40);
        }
      },
    ],
    fg: (c, r) => {
      // hanging banners and rope lines in the extreme foreground
      for (let i = 0; i < 4; i++) {
        const x = 120 + i * 250 + r() * 60;
        c.fillRect(x - 1, 0, 2, 150 + r() * 80);
        c.beginPath();
        c.moveTo(x - 20, 40);
        c.lineTo(x + 20, 40);
        c.lineTo(x + 18, 170 + r() * 50);
        c.lineTo(x, 150 + r() * 40);
        c.lineTo(x - 18, 172);
        c.closePath();
        c.fill();
      }
    },
  },
  forest: {
    sky: ['#04090b', '#0b1815', '#173029', '#2a4a40'],
    horizonGlow: 'rgba(120,170,150,0.1)',
    moon: true,
    colors: ['#1a312d', '#12261f', '#0a1815', '#050f0c', '#020605'],
    fog: '80,130,115',
    fogColor: 0x3d6358,
    fogAlpha: 0.22,
    glow: 0xa8e0c0,
    factors: [0.05, 0.13, 0.28, 0.5],
    vFactors: [0.03, 0.07, 0.14, 0.25],
    layers: [
      (c, r) => {
        ridge(c, r, 440, 110, 14);
        for (let i = 0; i < 14; i++) wrap(c, r() * W, 30, (x) => tree(c, r, x, 440, 70 + r() * 60, 5, 3));
      },
      (c, r) => {
        for (let i = 0; i < 12; i++) wrap(c, 30 + i * 85 + r() * 30, 60, (x) => tree(c, r, x, 490, 220 + r() * 120, 9, 4));
        c.fillRect(0, 490, W, 40);
      },
      (c, r) => {
        for (let i = 0; i < 7; i++) wrap(c, 40 + i * 150 + r() * 50, 80, (x) => tree(c, r, x, 505, 330 + r() * 120, 17, 5));
        for (let i = 0; i < 18; i++) wrap(c, r() * W, 10, (x) => vine(c, r, x, 0, 80 + r() * 180));
        c.fillRect(0, 505, W, 30);
      },
      (c, r) => {
        for (let i = 0; i < 4; i++) wrap(c, 80 + i * 260 + r() * 70, 110, (x) => tree(c, r, x, 510, 400 + r() * 60, 30, 3));
        for (let i = 0; i < 26; i++) wrap(c, r() * W, 10, (x) => vine(c, r, x, 0, 60 + r() * 140));
        // ferns
        for (let i = 0; i < 20; i++) {
          const x = r() * W;
          wrap(c, x, 20, (xx) => {
            for (let k = 0; k < 5; k++) {
              c.beginPath();
              c.moveTo(xx, 512);
              c.quadraticCurveTo(xx + (k - 2) * 8, 480, xx + (k - 2) * 16, 484 + Math.abs(k - 2) * 5);
              c.lineTo(xx + (k - 2) * 7, 512);
              c.fill();
            }
          });
        }
        c.fillRect(0, 508, W, 30);
      },
    ],
    fg: (c, r) => {
      for (let i = 0; i < 2; i++) wrap(c, 90 + i * 560, 140, (x) => tree(c, r, x, 520, 620, 52, 3));
      for (let i = 0; i < 10; i++) wrap(c, r() * W, 10, (x) => vine(c, r, x, 0, 100 + r() * 160));
    },
  },
  village: {
    sky: ['#05080c', '#0f1a22', '#22343d', '#415a5f'],
    horizonGlow: 'rgba(160,190,190,0.1)',
    moon: true,
    colors: ['#243439', '#1a292f', '#111d22', '#091217', '#03080a'],
    fog: '110,150,155',
    fogColor: 0x5c7c80,
    fogAlpha: 0.26,
    glow: 0xe0a040,
    factors: [0.05, 0.12, 0.26, 0.48],
    vFactors: [0.03, 0.07, 0.14, 0.25],
    layers: [
      (c, r) => {
        ridge(c, r, 430, 100, 16);
        wrap(c, 300, 60, (x) => shikhara(c, x, 400, 52, 150));
        wrap(c, 760, 60, (x) => gopuram(c, x, 405, 70, 4, 24));
      },
      (c, r) => {
        for (let i = 0; i < 6; i++) wrap(c, 60 + i * 175 + r() * 50, 70, (x) => {
          if (r() < 0.5) {
            arch(c, x, 480, 44, 90 + r() * 40, 16);
          } else {
            shikhara(c, x, 480, 50, 120 + r() * 60); // broken spire
          }
        });
        c.fillRect(0, 480, W, 50);
      },
      (c, r) => {
        for (let i = 0; i < 7; i++) wrap(c, 40 + i * 150 + r() * 40, 60, (x) => stiltHut(c, x, 498, 50 + r() * 20));
        for (let i = 0; i < 5; i++) wrap(c, r() * W, 20, (x) => palm(c, r, x, 500, 130 + r() * 60));
        c.fillRect(0, 498, W, 30);
        windowsDots(c, r, 0, W, 430, 480, 10, AMBER);
      },
      (c, r) => {
        for (let i = 0; i < 6; i++) wrap(c, 30 + i * 175 + r() * 60, 40, (x) => column(c, x, 512, 26 + r() * 10, 120 + r() * 140));
        for (let i = 0; i < 8; i++) wrap(c, r() * W, 20, (x) => palm(c, r, x, 512, 110 + r() * 90));
        c.fillRect(0, 508, W, 30);
      },
    ],
    fg: (c, r) => {
      for (let i = 0; i < 26; i++) {
        const x = r() * W;
        wrap(c, x, 10, (xx) => {
          c.beginPath();
          c.moveTo(xx, 512);
          c.quadraticCurveTo(xx + (r() - 0.5) * 20, 400, xx + (r() - 0.5) * 30, 320 + r() * 100);
          c.lineTo(xx + 3, 512);
          c.fill();
        });
      }
      for (let i = 0; i < 6; i++) wrap(c, r() * W, 10, (x) => vine(c, r, x, 0, 80 + r() * 100));
    },
  },
  sanctum: {
    sky: ['#040306', '#0b0709', '#1a0f0c', '#3a2112'],
    horizonGlow: 'rgba(224,130,40,0.28)',
    moon: false,
    colors: ['#2b1a0e', '#20130a', '#150d07', '#0b0705', '#040201'],
    fog: '120,70,30',
    fogColor: 0x6b3d1a,
    fogAlpha: 0.2,
    glow: 0xe0a040,
    factors: [0.05, 0.12, 0.26, 0.48],
    vFactors: [0.04, 0.09, 0.16, 0.28],
    layers: [
      (c, r) => {
        for (let i = 0; i < 9; i++) wrap(c, i * 120 + r() * 40, 30, (x) => stalactite(c, x, 0, 30 + r() * 30, 80 + r() * 120));
        for (let i = 0; i < 4; i++) wrap(c, 120 + i * 250, 80, (x) => arch(c, x, 500, 110, 200, 30));
        c.fillRect(0, 490, W, 50);
      },
      (c, r) => {
        for (let i = 0; i < 6; i++) wrap(c, 40 + i * 175 + r() * 30, 40, (x) => {
          column(c, x, 512, 34, 330 + r() * 80);
        });
        // Glyph strips glow added on top later through sprites; draw notches
        c.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 6; i++) {
          const x = 40 + i * 175;
          for (let k = 0; k < 6; k++) c.fillRect(x - 3, 250 + k * 36, 6, 3);
        }
        c.globalCompositeOperation = 'source-over';
        c.fillRect(0, 500, W, 30);
      },
      (c, r) => {
        // hanging chains and a big carved ring
        for (let i = 0; i < 9; i++) {
          const x = 30 + i * 112 + r() * 30;
          const len = 100 + r() * 220;
          wrap(c, x, 10, (xx) => {
            for (let y = 0; y < len; y += 10) c.fillRect(xx - 1.5 + Math.sin(y * 0.2) * 1.5, y, 3, 6);
          });
        }
        for (let i = 0; i < 6; i++) wrap(c, 60 + i * 170 + r() * 40, 30, (x) => stalagmite(c, x, 512, 50 + r() * 40, 70 + r() * 110));
        for (let i = 0; i < 7; i++) wrap(c, r() * W, 30, (x) => stalactite(c, x, 0, 40 + r() * 30, 100 + r() * 150));
      },
      (c, r) => {
        for (let i = 0; i < 8; i++) wrap(c, i * 128 + r() * 50, 50, (x) => stalactite(c, x, 0, 50 + r() * 50, 90 + r() * 170));
        for (let i = 0; i < 6; i++) wrap(c, 40 + i * 180 + r() * 60, 50, (x) => stalagmite(c, x, 512, 60 + r() * 50, 50 + r() * 100));
      },
    ],
    fg: (c, r) => {
      for (let i = 0; i < 5; i++) wrap(c, 40 + i * 210 + r() * 80, 50, (x) => stalactite(c, x, 0, 60 + r() * 40, 120 + r() * 140));
      for (let i = 0; i < 3; i++) wrap(c, 100 + i * 340, 60, (x) => stalagmite(c, x, 512, 80, 80 + r() * 60));
    },
  },
};

function paintLayer(scene: Phaser.Scene, key: string, fill: string, fog: string, fogStrength: number, fn: LayerFn, seed: number) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, W, H);
  if (!tex) return;
  const c = tex.getContext();
  const r = rng(seed);
  c.clearRect(0, 0, W, H);
  c.fillStyle = fill;
  c.strokeStyle = fill;
  fn(c, r);
  // Atmospheric mist toward the bottom of each layer, clipped to the silhouette.
  c.globalCompositeOperation = 'source-atop';
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(${fog},0)`);
  g.addColorStop(0.55, `rgba(${fog},${fogStrength * 0.35})`);
  g.addColorStop(1, `rgba(${fog},${fogStrength})`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'source-over';
  tex.refresh();
}

function paintSky(scene: Phaser.Scene, key: string, def: ThemeDef, seed: number) {
  if (scene.textures.exists(key)) return;
  const SW = 512;
  const SH = 540;
  const tex = scene.textures.createCanvas(key, SW, SH);
  if (!tex) return;
  const c = tex.getContext();
  const r = rng(seed);
  const g = c.createLinearGradient(0, 0, 0, SH);
  def.sky.forEach((col, i) => g.addColorStop(i / (def.sky.length - 1), col));
  c.fillStyle = g;
  c.fillRect(0, 0, SW, SH);
  // Stars (sparse - it is a storm).
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(220,235,255,${0.1 + r() * 0.4})`;
    c.fillRect(r() * SW, r() * SH * 0.5, 1.2, 1.2);
  }
  // Horizon glow.
  const hg = c.createLinearGradient(0, SH * 0.55, 0, SH);
  hg.addColorStop(0, 'rgba(0,0,0,0)');
  hg.addColorStop(1, def.horizonGlow);
  c.fillStyle = hg;
  c.fillRect(0, SH * 0.55, SW, SH * 0.45);
  // Storm clouds: soft dark bands.
  for (let i = 0; i < 9; i++) {
    const cy = 40 + r() * 280;
    const cx = r() * SW;
    const cw = 120 + r() * 220;
    c.save();
    c.translate(cx, cy);
    c.scale(1, 0.18 + r() * 0.12);
    const cg = c.createRadialGradient(0, 0, 0, 0, 0, cw);
    cg.addColorStop(0, 'rgba(4,8,16,0.5)');
    cg.addColorStop(1, 'rgba(4,8,16,0)');
    c.fillStyle = cg;
    c.fillRect(-cw, -cw, cw * 2, cw * 2);
    c.restore();
  }
  tex.refresh();
}

function blend(hex: string, fog: string, k: number): number {
  const n = parseInt(hex.slice(1), 16);
  const [fr, fg, fb] = fog.split(',').map(Number);
  const r = Math.round(((n >> 16) & 255) * (1 - k) + fr * k);
  const g = Math.round(((n >> 8) & 255) * (1 - k) + fg * k);
  const b = Math.round((n & 255) * (1 - k) + fb * k);
  return (r << 16) | (g << 8) | b;
}

let currentTheme: Theme | null = null;
const themeKeys: Record<string, string[]> = {};

export function buildBackdrop(scene: Phaser.Scene, theme: Theme): BackdropSet {
  const def = THEMES[theme];
  const seedBase = { fortress: 11, forest: 23, village: 37, sanctum: 51 }[theme];
  // Free textures of any other theme to keep memory bounded on mobile.
  if (currentTheme && currentTheme !== theme) {
    for (const k of themeKeys[currentTheme] ?? []) if (scene.textures.exists(k)) scene.textures.remove(k);
    delete themeKeys[currentTheme];
  }
  currentTheme = theme;
  const keys: string[] = [];
  const skyKey = `bg_${theme}_sky`;
  keys.push(skyKey);
  paintSky(scene, skyKey, def, seedBase);
  const layers: LayerSpec[] = [];
  def.layers.forEach((fn, i) => {
    const key = `bg_${theme}_${i}`;
    keys.push(key);
    paintLayer(scene, key, def.colors[i], def.fog, 0.55 - i * 0.12, fn, seedBase * 100 + i);
    layers.push({ key, fill: blend(def.colors[i], def.fog, 0.55 - i * 0.12), factor: def.factors[i], vFactor: def.vFactors[i] });
  });
  const fgKey = `bg_${theme}_fg`;
  keys.push(fgKey);
  paintLayer(scene, fgKey, def.colors[4], def.fog, 0.1, def.fg, seedBase * 100 + 9);
  themeKeys[theme] = keys;
  return {
    theme,
    skyKey,
    layers,
    fg: { key: fgKey, fill: 0, factor: 1.35, vFactor: 0.4 },
    fogColor: def.fogColor,
    fogAlpha: def.fogAlpha,
    glow: def.glow,
    moon: def.moon,
  };
}

/** Moon sprite (separate texture so it is never stretched with the sky). */
export function ensureMoon(scene: Phaser.Scene) {
  if (scene.textures.exists('moon')) return;
  const tex = scene.textures.createCanvas('moon', 320, 320);
  if (!tex) return;
  const c = tex.getContext();
  const g = c.createRadialGradient(160, 160, 8, 160, 160, 160);
  g.addColorStop(0, 'rgba(207,224,242,0.55)');
  g.addColorStop(0.3, 'rgba(160,190,225,0.16)');
  g.addColorStop(1, 'rgba(160,190,225,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 320, 320);
  c.fillStyle = 'rgba(232,242,255,0.96)';
  c.beginPath();
  c.arc(160, 160, 26, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(160,185,215,0.35)';
  for (const [dx, dy, rr] of [[-8, -4, 6], [7, 8, 4.5], [4, -10, 3.5]]) {
    c.beginPath();
    c.arc(160 + dx, 160 + dy, rr, 0, Math.PI * 2);
    c.fill();
  }
  tex.refresh();
}

export const LAYER_W = W;
export const LAYER_H = H;
