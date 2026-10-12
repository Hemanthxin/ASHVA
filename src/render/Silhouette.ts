import Phaser from 'phaser';
import { PAL } from '../config/gameConfig';

/**
 * Procedural silhouette rig. A humanoid is solved from a handful of joint angles and drawn with
 * thick tapered limbs into a Phaser Graphics object. Rig space: origin at the feet, +x forward
 * (mirrored by `facing`), -y up. Limb angles are measured from straight-down, positive = forward.
 */
export interface Pose {
  lean: number; // torso forward lean (rad)
  lift: number; // extra hip height (airborne / jump)
  head: number; // head tilt offset (rad)
  armF: [number, number]; // [shoulder angle, elbow flex]
  armB: [number, number];
  legF: [number, number]; // [hip angle, knee flex]
  legB: [number, number];
  weapon: number | null; // absolute weapon angle (0 = down, +forward) held in front hand
  crouch?: number; // pulls head/torso down visually (shortens the torso)
}

export type HeadGear = 'hood' | 'helm' | 'crown' | 'bare';
export type WeaponKind = 'blade' | 'spear' | 'greatblade' | 'mace';

export interface RigStyle {
  scale: number;
  thigh: number;
  shin: number;
  torso: number;
  upperArm: number;
  foreArm: number;
  headR: number;
  thick: number; // limb thickness multiplier
  chest: number; // half chest depth
  gear: HeadGear;
  weaponKind: WeaponKind;
  weaponLen: number;
  eye: number; // glow colour
  cape: boolean;
  pauldron: boolean;
}

export const ARU_STYLE: RigStyle = {
  scale: 0.95, thigh: 13, shin: 13, torso: 19, upperArm: 10, foreArm: 10, headR: 5.6, thick: 1,
  chest: 4.6, gear: 'hood', weaponKind: 'blade', weaponLen: 34, eye: PAL.white, cape: true, pauldron: false,
};
export const SENTINEL_STYLE: RigStyle = {
  scale: 1.0, thigh: 14, shin: 14, torso: 20, upperArm: 11, foreArm: 11, headR: 6, thick: 1.25,
  chest: 6.2, gear: 'helm', weaponKind: 'spear', weaponLen: 62, eye: PAL.amber, cape: false, pauldron: true,
};
export const ELITE_STYLE: RigStyle = {
  scale: 1.18, thigh: 14, shin: 14, torso: 21, upperArm: 11, foreArm: 12, headR: 6.2, thick: 1.5,
  chest: 7.2, gear: 'helm', weaponKind: 'greatblade', weaponLen: 56, eye: PAL.crimsonHot, cape: true, pauldron: true,
};
export const BOSS_STYLE: RigStyle = {
  scale: 2.35, thigh: 15, shin: 15, torso: 22, upperArm: 13, foreArm: 14, headR: 6.5, thick: 1.6,
  chest: 8.2, gear: 'crown', weaponKind: 'mace', weaponLen: 54, eye: PAL.amberHot, cape: true, pauldron: true,
};

export const neutralPose = (): Pose => ({
  lean: 0, lift: 0, head: 0, armF: [0.1, 0.3], armB: [-0.1, 0.3], legF: [0.05, 0.1], legB: [-0.05, 0.1], weapon: null,
});

export interface Joints {
  hip: Phaser.Math.Vector2;
  neck: Phaser.Math.Vector2;
  shoulder: Phaser.Math.Vector2;
  head: Phaser.Math.Vector2;
  kneeF: Phaser.Math.Vector2; footF: Phaser.Math.Vector2;
  kneeB: Phaser.Math.Vector2; footB: Phaser.Math.Vector2;
  elbF: Phaser.Math.Vector2; handF: Phaser.Math.Vector2;
  elbB: Phaser.Math.Vector2; handB: Phaser.Math.Vector2;
}

const V = (x = 0, y = 0) => new Phaser.Math.Vector2(x, y);
export function makeJoints(): Joints {
  return {
    hip: V(), neck: V(), shoulder: V(), head: V(), kneeF: V(), footF: V(), kneeB: V(), footB: V(),
    elbF: V(), handF: V(), elbB: V(), handB: V(),
  };
}

/** Forward kinematics into `j` (local rig space, unscaled). */
export function solve(p: Pose, st: RigStyle, j: Joints): Joints {
  const depth = (l: [number, number]) => st.thigh * Math.cos(l[0]) + st.shin * Math.cos(l[0] - l[1]);
  const hipH = Math.max(depth(p.legF), depth(p.legB)) + p.lift;
  j.hip.set(0, -hipH);
  const torsoLen = st.torso * (1 - (p.crouch ?? 0) * 0.12);
  const ax = Math.sin(p.lean);
  const ay = -Math.cos(p.lean);
  j.neck.set(j.hip.x + ax * torsoLen, j.hip.y + ay * torsoLen);
  j.shoulder.set(j.hip.x + ax * (torsoLen - 3), j.hip.y + ay * (torsoLen - 3));
  const ha = p.lean + p.head;
  j.head.set(j.neck.x + Math.sin(ha) * st.headR * 1.2, j.neck.y - Math.cos(ha) * st.headR * 1.2);
  const leg = (l: [number, number], knee: Phaser.Math.Vector2, foot: Phaser.Math.Vector2) => {
    knee.set(j.hip.x + Math.sin(l[0]) * st.thigh, j.hip.y + Math.cos(l[0]) * st.thigh);
    foot.set(knee.x + Math.sin(l[0] - l[1]) * st.shin, knee.y + Math.cos(l[0] - l[1]) * st.shin);
  };
  leg(p.legF, j.kneeF, j.footF);
  leg(p.legB, j.kneeB, j.footB);
  const arm = (a: [number, number], elb: Phaser.Math.Vector2, hand: Phaser.Math.Vector2) => {
    elb.set(j.shoulder.x + Math.sin(a[0]) * st.upperArm, j.shoulder.y + Math.cos(a[0]) * st.upperArm);
    hand.set(elb.x + Math.sin(a[0] + a[1]) * st.foreArm, elb.y + Math.cos(a[0] + a[1]) * st.foreArm);
  };
  arm(p.armF, j.elbF, j.handF);
  arm(p.armB, j.elbB, j.handB);
  return j;
}

export interface DrawOpts {
  color?: number;
  alpha?: number;
  rim?: boolean;
  rimColor?: number;
  rimAlpha?: number;
  /** Trailing cloth points in WORLD space (scarf). */
  scarf?: Array<{ x: number; y: number }>;
  eyeGlow?: number; // 0..1
  flash?: number; // 0..1 white hit flash
  showWeapon?: boolean;
  weaponGlow?: number; // 0..1 blade glow (amber)
  tilt?: number; // whole-body rotation (rad), e.g. vault flip
}

const scratch = makeJoints();

/** Draw a posed rig at world feet position (x,y). */
export function drawRig(g: Phaser.GameObjects.Graphics, x: number, y: number, facing: 1 | -1, pose: Pose, st: RigStyle, o: DrawOpts = {}) {
  solve(pose, st, scratch);
  const j = scratch;
  const s = st.scale;
  const tilt = o.tilt ?? 0;
  const ct = Math.cos(tilt);
  const stt = Math.sin(tilt);
  // Local -> world (with optional rotation about the hip).
  const hx = j.hip.x;
  const hy = j.hip.y;
  const tx = (lx: number, ly: number) => {
    const rx = lx - hx;
    const ry = ly - hy;
    return x + facing * (hx + rx * ct - ry * stt) * s;
  };
  const ty = (lx: number, ly: number) => {
    const rx = lx - hx;
    const ry = ly - hy;
    return y + (hy + rx * stt + ry * ct) * s;
  };

  const pass = (ox: number, oy: number, color: number, alpha: number, detail: boolean) => {
    const tk = st.thick * s;
    const seg = (a: Phaser.Math.Vector2, b: Phaser.Math.Vector2, w: number) => {
      g.lineStyle(w * tk, color, alpha);
      g.beginPath();
      g.moveTo(tx(a.x, a.y) + ox, ty(a.x, a.y) + oy);
      g.lineTo(tx(b.x, b.y) + ox, ty(b.x, b.y) + oy);
      g.strokePath();
    };
    const dot = (a: Phaser.Math.Vector2, r: number) => {
      g.fillStyle(color, alpha);
      g.fillCircle(tx(a.x, a.y) + ox, ty(a.x, a.y) + oy, r * tk);
    };
    // Back limbs.
    seg(j.hip, j.kneeB, 5.2); seg(j.kneeB, j.footB, 4.2); dot(j.kneeB, 2.3);
    // foot
    seg(j.footB, { x: j.footB.x + 5, y: j.footB.y } as Phaser.Math.Vector2, 3);
    seg(j.shoulder, j.elbB, 4); seg(j.elbB, j.handB, 3.2); dot(j.elbB, 1.9); dot(j.handB, 2);

    // Cape (behind torso).
    if (st.cape && detail) {
      g.fillStyle(color, alpha);
      g.beginPath();
      g.moveTo(tx(j.shoulder.x, j.shoulder.y) + ox, ty(j.shoulder.x, j.shoulder.y) + oy);
      g.lineTo(tx(j.hip.x - 9, j.hip.y + 9) + ox, ty(j.hip.x - 9, j.hip.y + 9) + oy);
      g.lineTo(tx(j.hip.x - 2, j.hip.y + 3) + ox, ty(j.hip.x - 2, j.hip.y + 3) + oy);
      g.closePath();
      g.fillPath();
    }

    // Torso: tapered polygon from hip to shoulders.
    const nx = Math.cos(pose.lean);
    const ny = Math.sin(pose.lean);
    const wc = st.chest;
    const wh = st.chest * 0.75;
    const pts = [
      [j.hip.x - nx * wh, j.hip.y - ny * wh],
      [j.hip.x + nx * wh, j.hip.y + ny * wh],
      [j.neck.x + nx * wc * 0.9, j.neck.y + ny * wc * 0.9],
      [j.neck.x - nx * wc * 0.7, j.neck.y - ny * wc * 0.7],
    ];
    g.fillStyle(color, alpha);
    g.beginPath();
    g.moveTo(tx(pts[0][0], pts[0][1]) + ox, ty(pts[0][0], pts[0][1]) + oy);
    for (let i = 1; i < 4; i++) g.lineTo(tx(pts[i][0], pts[i][1]) + ox, ty(pts[i][0], pts[i][1]) + oy);
    g.closePath();
    g.fillPath();
    // Neck + head.
    seg(j.neck, j.head, 3);
    g.fillStyle(color, alpha);
    g.fillCircle(tx(j.head.x, j.head.y) + ox, ty(j.head.x, j.head.y) + oy, st.headR * s);

    if (detail) drawGear(g, st, pose, j, tx, ty, ox, oy, color, alpha, s, facing);

    // Front limbs.
    seg(j.hip, j.kneeF, 5.6); seg(j.kneeF, j.footF, 4.6); dot(j.kneeF, 2.5);
    seg(j.footF, { x: j.footF.x + 5.5, y: j.footF.y } as Phaser.Math.Vector2, 3.2);
    if (st.pauldron && detail) {
      g.fillStyle(color, alpha);
      g.fillCircle(tx(j.shoulder.x, j.shoulder.y) + ox, ty(j.shoulder.x, j.shoulder.y) + oy, 5.6 * tk);
    }
    seg(j.shoulder, j.elbF, 4.6); seg(j.elbF, j.handF, 3.8); dot(j.elbF, 2.1); dot(j.handF, 2.3);

    // Weapon.
    if (pose.weapon !== null && o.showWeapon !== false) {
      const wa = pose.weapon;
      const dx = Math.sin(wa);
      const dy = Math.cos(wa);
      const L = st.weaponLen;
      const bx = j.handF.x - dx * 5;
      const by = j.handF.y - dy * 5;
      const ex = j.handF.x + dx * L;
      const ey = j.handF.y + dy * L;
      const wx = st.weaponKind === 'greatblade' || st.weaponKind === 'mace' ? 4.2 : st.weaponKind === 'spear' ? 1.8 : 2.4;
      g.lineStyle(wx * tk, color, alpha);
      g.beginPath();
      g.moveTo(tx(bx, by) + ox, ty(bx, by) + oy);
      g.lineTo(tx(ex, ey) + ox, ty(ex, ey) + oy);
      g.strokePath();
      if (st.weaponKind === 'spear') {
        // Spearhead + crossguard.
        const px = -dy;
        const py = dx;
        g.fillStyle(color, alpha);
        g.beginPath();
        g.moveTo(tx(ex + dx * 12, ey + dy * 12) + ox, ty(ex + dx * 12, ey + dy * 12) + oy);
        g.lineTo(tx(ex + px * 3.5, ey + py * 3.5) + ox, ty(ex + px * 3.5, ey + py * 3.5) + oy);
        g.lineTo(tx(ex - px * 3.5, ey - py * 3.5) + ox, ty(ex - px * 3.5, ey - py * 3.5) + oy);
        g.closePath();
        g.fillPath();
      } else if (st.weaponKind === 'mace') {
        g.fillStyle(color, alpha);
        g.fillCircle(tx(ex, ey) + ox, ty(ex, ey) + oy, 9 * s * 0.6);
      } else {
        // guard
        const px = -dy;
        const py = dx;
        g.lineStyle(2 * tk, color, alpha);
        g.beginPath();
        g.moveTo(tx(j.handF.x + dx * 3 + px * 3.5, j.handF.y + dy * 3 + py * 3.5) + ox, ty(j.handF.x + dx * 3 + px * 3.5, j.handF.y + dy * 3 + py * 3.5) + oy);
        g.lineTo(tx(j.handF.x + dx * 3 - px * 3.5, j.handF.y + dy * 3 - py * 3.5) + ox, ty(j.handF.x + dx * 3 - px * 3.5, j.handF.y + dy * 3 - py * 3.5) + oy);
        g.strokePath();
      }
    }
  };

  const color = o.color ?? PAL.obsidian;
  const alpha = o.alpha ?? 1;
  if (o.rim !== false) {
    const rimA = (o.rimAlpha ?? 0.5) * alpha;
    pass(-1.4 * facing, -1.2, o.rimColor ?? PAL.stormLight, rimA, false);
  }
  pass(0, 0, color, alpha, true);

  // Scarf / cloth trail (world-space points).
  if (o.scarf && o.scarf.length > 1) {
    const sc = o.scarf;
    for (let i = 1; i < sc.length; i++) {
      const w = (1 - i / sc.length) * 4.2 * s + 0.6;
      g.lineStyle(w, color, alpha);
      g.beginPath();
      g.moveTo(sc[i - 1].x, sc[i - 1].y);
      g.lineTo(sc[i].x, sc[i].y);
      g.strokePath();
    }
  }

  // Glowing eye / visor and blade edge are drawn above the silhouette.
  const eg = o.eyeGlow ?? 1;
  if (eg > 0 && alpha > 0.5) {
    const ex = tx(j.head.x + 3.2, j.head.y - 0.8);
    const ey = ty(j.head.x + 3.2, j.head.y - 0.8);
    g.fillStyle(st.eye, 0.9 * eg * alpha);
    g.fillRect(ex - 1.2 * s, ey - 0.8 * s, 3.4 * s * (st.gear === 'crown' ? 1.4 : 1), 1.6 * s);
  }
  if (pose.weapon !== null && o.showWeapon !== false && alpha > 0.5) {
    const wa = pose.weapon;
    const dx = Math.sin(wa);
    const dy = Math.cos(wa);
    const L = st.weaponLen;
    const sx = j.handF.x + dx * 6;
    const sy = j.handF.y + dy * 6;
    const ex = j.handF.x + dx * L;
    const ey = j.handF.y + dy * L;
    const glow = o.weaponGlow ?? 0;
    const edge = glow > 0 ? PAL.amberHot : PAL.moon;
    g.lineStyle(1.1, edge, 0.55 + glow * 0.45);
    g.beginPath();
    g.moveTo(tx(sx, sy) - 0.8 * facing, ty(sx, sy) - 0.8);
    g.lineTo(tx(ex, ey) - 0.8 * facing, ty(ex, ey) - 0.8);
    g.strokePath();
  }
  if ((o.flash ?? 0) > 0) {
    // White hit-flash: redraw simple body in white.
    pass(0, 0, PAL.white, Math.min(1, o.flash!) * 0.85, false);
  }
}

function drawGear(
  g: Phaser.GameObjects.Graphics, st: RigStyle, pose: Pose, j: Joints,
  tx: (x: number, y: number) => number, ty: (x: number, y: number) => number,
  ox: number, oy: number, color: number, alpha: number, s: number, facing: 1 | -1,
) {
  g.fillStyle(color, alpha);
  const hx = j.head.x;
  const hy = j.head.y;
  const tri = (a: number[], b: number[], c: number[]) => {
    g.beginPath();
    g.moveTo(tx(a[0], a[1]) + ox, ty(a[0], a[1]) + oy);
    g.lineTo(tx(b[0], b[1]) + ox, ty(b[0], b[1]) + oy);
    g.lineTo(tx(c[0], c[1]) + ox, ty(c[0], c[1]) + oy);
    g.closePath();
    g.fillPath();
  };
  const hr = st.headR;
  if (st.gear === 'hood') {
    // Pointed hood sweeping back.
    tri([hx + hr * 0.4, hy - hr * 1.1], [hx - hr * 2.4, hy + hr * 0.6], [hx - hr * 0.5, hy + hr * 0.9]);
  } else if (st.gear === 'helm') {
    // Conical helm with plume.
    tri([hx - hr * 1.0, hy - hr * 0.2], [hx + hr * 1.0, hy - hr * 0.2], [hx + hr * 0.1, hy - hr * 2.4]);
    tri([hx - hr * 0.8, hy - hr * 1.0], [hx - hr * 2.6, hy - hr * 1.4], [hx - hr * 0.2, hy - hr * 1.9]);
  } else if (st.gear === 'crown') {
    // Broken crown / horns.
    tri([hx - hr * 0.9, hy - hr * 0.6], [hx - hr * 0.2, hy - hr * 0.8], [hx - hr * 1.6, hy - hr * 3.0]);
    tri([hx + hr * 0.1, hy - hr * 0.8], [hx + hr * 0.9, hy - hr * 0.5], [hx + hr * 1.7, hy - hr * 2.8]);
    tri([hx - hr * 0.5, hy - hr * 0.9], [hx + hr * 0.4, hy - hr * 0.9], [hx - hr * 0.1, hy - hr * 2.4]);
  }
  // Belt sash for the player-style rigs.
  if (st.cape && st.gear === 'hood') {
    g.lineStyle(2.2 * s, color, alpha);
    g.beginPath();
    g.moveTo(tx(j.hip.x - 4, j.hip.y - 1) + ox, ty(j.hip.x - 4, j.hip.y - 1) + oy);
    g.lineTo(tx(j.hip.x - 9, j.hip.y + 8 + pose.lean * 3) + ox, ty(j.hip.x - 9, j.hip.y + 8) + oy);
    g.strokePath();
  }
  void facing;
}

/** Verlet-ish cloth chain used for Aru's scarf. */
export class Cloth {
  pts: Array<{ x: number; y: number }> = [];
  constructor(public n = 8, public seg = 5.5) {
    for (let i = 0; i < n; i++) this.pts.push({ x: 0, y: 0 });
  }
  reset(x: number, y: number) {
    for (const p of this.pts) {
      p.x = x;
      p.y = y;
    }
  }
  /** Anchor in world space; `back` is the preferred trailing direction (-facing). */
  update(ax: number, ay: number, back: number, dt: number, t: number) {
    const p = this.pts;
    p[0].x = ax;
    p[0].y = ay;
    for (let i = 1; i < p.length; i++) {
      const prev = p[i - 1];
      const cur = p[i];
      // Light drift behind the wearer + flutter.
      cur.x += back * 70 * dt * (0.4 + i * 0.1);
      cur.y += Math.sin(t * 9 + i * 0.9) * 22 * dt + 30 * dt;
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const d = Math.hypot(dx, dy) || 1;
      cur.x = prev.x + (dx / d) * this.seg;
      cur.y = prev.y + (dy / d) * this.seg;
    }
  }
}

const jScratch = makeJoints();
/** World position of a named joint for the given pose (ignores whole-body tilt). */
export function jointWorld(name: 'neck' | 'head' | 'handF' | 'hip' | 'shoulder' | 'footF' | 'footB', pose: Pose, st: RigStyle, x: number, y: number, facing: 1 | -1): { x: number; y: number } {
  solve(pose, st, jScratch);
  const p = jScratch[name];
  return { x: x + facing * p.x * st.scale, y: y + p.y * st.scale };
}
