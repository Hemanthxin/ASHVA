import Phaser from 'phaser';

/**
 * Every texture in ASHVA is generated in code. This module builds the small shared set (glows,
 * rain, particles, vignette). Nothing is fetched over the network, so a missing asset can never
 * crash the game. `ensureTextures` is idempotent.
 */
function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, paint: (c: CanvasRenderingContext2D) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  paint(ctx);
  tex.refresh();
}

export function ensureTextures(scene: Phaser.Scene) {
  canvasTex(scene, 'px', 4, 4, (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 4, 4);
  });

  canvasTex(scene, 'dot', 16, 16, (c) => {
    const g = c.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 16, 16);
  });

  canvasTex(scene, 'glow', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });

  canvasTex(scene, 'blob', 256, 128, (c) => {
    c.save();
    c.translate(128, 64);
    c.scale(1, 0.5);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(-128, -128, 256, 256);
    c.restore();
  });

  canvasTex(scene, 'streak', 24, 4, (c) => {
    const g = c.createLinearGradient(0, 0, 24, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g;
    c.fillRect(0, 0, 24, 4);
  });

  canvasTex(scene, 'ring', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 40, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });

  canvasTex(scene, 'smoke', 64, 64, (c) => {
    for (let i = 0; i < 6; i++) {
      const x = 20 + Math.random() * 24;
      const y = 20 + Math.random() * 24;
      const r = 12 + Math.random() * 12;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
    }
  });

  // Two rain layers (tileable 256x256, ~14 degrees off vertical).
  for (const [key, count, alpha, len] of [['rainNear', 34, 0.5, 26], ['rainFar', 60, 0.28, 14]] as const) {
    canvasTex(scene, key, 256, 256, (c) => {
      c.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const l = len * (0.7 + Math.random() * 0.6);
        c.strokeStyle = `rgba(190,215,255,${alpha * (0.5 + Math.random() * 0.5)})`;
        c.lineWidth = key === 'rainNear' ? 1.4 : 1;
        const dx = Math.sin(0.25) * l;
        const dy = Math.cos(0.25) * l;
        for (const ox of [-256, 0, 256]) {
          for (const oy of [-256, 0, 256]) {
            c.beginPath();
            c.moveTo(x + ox, y + oy);
            c.lineTo(x + ox - dx, y + oy + dy);
            c.stroke();
          }
        }
      }
    });
  }

  canvasTex(scene, 'vignette', 512, 288, (c) => {
    const g = c.createRadialGradient(256, 144, 90, 256, 144, 320);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0.85)');
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 288);
  });

  canvasTex(scene, 'vignetteRed', 512, 288, (c) => {
    const g = c.createRadialGradient(256, 144, 110, 256, 144, 300);
    g.addColorStop(0, 'rgba(160,24,38,0)');
    g.addColorStop(1, 'rgba(160,24,38,0.7)');
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 288);
  });

  canvasTex(scene, 'vignetteViolet', 512, 288, (c) => {
    const g = c.createRadialGradient(256, 144, 110, 256, 144, 300);
    g.addColorStop(0, 'rgba(122,92,255,0)');
    g.addColorStop(1, 'rgba(122,92,255,0.55)');
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 288);
  });
}
