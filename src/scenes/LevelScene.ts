import Phaser from 'phaser';
import { PAL, VIEW_H } from '../config/gameConfig';
import { audio } from '../systems/AudioSystem';
import { input } from '../systems/InputSystem';
import { save } from '../systems/SaveSystem';
import { Solid, moveBody, updateSolids } from '../systems/MovementSystem';
import { ShadowDebt, REVEAL_THRESHOLD } from '../systems/ShadowDebtSystem';
import { HitInfo, hitInfo } from '../systems/CombatSystem';
import { Atmosphere } from '../render/Atmosphere';
import { Fx } from '../render/Fx';
import { InteractView, PropView, drawInteract, drawShadowBridge, drawSolid, makeProp } from '../render/LevelArt';
import { SENTINEL_STYLE, Pose, drawRig, neutralPose } from '../render/Silhouette';
import { Player } from '../entities/Player';
import { Enemy, createEnemy } from '../entities/Enemy';
import { BOSS_MAX_HP, BOSS_NAME, Boss } from '../entities/Boss';
import type { Hittable, IWorld } from '../entities/World';
import type { EnemySpawn, HazardDef, LevelDef, RelicDef, SolidDef, TriggerDef } from '../data/types';
import { LEVELS, getLevel, levelIndex } from '../data/levels';
import { hud, fmt } from '../ui/HUD';
import { menus } from '../ui/Menus';
import { touch } from '../ui/TouchControls';
import { flow, session } from '../core/flow';
import { clamp, damp, overlap, sign } from '../utils/math';
import { ensureTextures } from '../utils/assetFallbacks';

interface StartData { levelId: string; checkpoint?: number }
interface SolidRt { solid: Solid; def: SolidDef; g: Phaser.GameObjects.Graphics; tilt: number }
interface HazardRt { def: HazardDef }
interface RelicRt { def: RelicDef; got: boolean; t: number }
interface Pickup { x: number; y: number; t: number; got: boolean }
interface Arena { id: string; enemies: Enemy[]; gates: string[]; lock: [number, number]; done: boolean }

const HINTS: Record<string, string> = {
  combat: '[light] strike  ·  [heavy] heavy blow  ·  [dodge] dodge  ·  hold [block] to guard. Tap guard just before a hit to PARRY.',
  shadow: '[shadow] Shadow Dash: a swift, invulnerable lunge that cuts through foes. Every use adds Shadow Debt.',
  debt: 'Shadow Debt: hidden paths appear at 40%, foes grow bolder past 50%. Pay it down at lamps, with embers, and by parrying.',
  parry: 'Parry stuns the attacker and lowers your Shadow Debt.',
  wall: 'Press [jump] against a wall to wall-jump.',
};

export class LevelScene extends Phaser.Scene implements IWorld {
  level!: LevelDef;
  solids: Solid[] = [];
  hittables: Hittable[] = [];
  enemies: Enemy[] = [];
  player!: Player;
  fx!: Fx;
  debt = new ShadowDebt();
  atmos!: Atmosphere;
  t = 0;
  boss: Boss | null = null;

  private startData: StartData = { levelId: 'c1a' };
  private solidRt: SolidRt[] = [];
  private moves = new Map<Solid, { dx: number; dy: number; period: number; phase: number }>();
  private props: PropView[] = [];
  private interacts: InteractView[] = [];
  private relics: RelicRt[] = [];
  private pickups: Pickup[] = [];
  private hazards: HazardRt[] = [];
  private triggers: Array<{ def: TriggerDef; fired: boolean }> = [];
  private cps: Array<{ x: number; y: number; name: string; reached: boolean }> = [];
  private arenas = new Map<string, Arena>();
  private hazG!: Phaser.GameObjects.Graphics;
  private relicG!: Phaser.GameObjects.Graphics;
  private chaseG!: Phaser.GameObjects.Graphics;
  private viewW = 960;
  private zoom = 1;
  private get vw() {
    return this.viewW / this.zoom;
  }
  private get vh() {
    return VIEW_H / this.zoom;
  }
  private computeZoom() {
    const dispH = Math.min(window.innerHeight, (window.innerWidth * VIEW_H) / this.viewW);
    this.zoom = clamp(1 + (640 - dispH) / 620, 1, 1.4);
    this.cameras.main.setZoom(this.zoom);
    this.atmos?.setZoom(this.zoom);
  }
  private acc = 0;
  private camX = 0;
  private camY = 0;
  private camLock: [number, number] | null = null;
  private camFocus: { x: number; y: number } | null = null;
  private locked = false;
  private ending = false;
  private cine: { lines: string[]; hold: number; i: number; t: number; onDone?: () => void } | null = null;
  private chase = { active: false, x: 0, ended: false, fade: 0 };
  private trail: Array<{ x: number; y: number }> = [];
  private trailT = 0;
  private lampsLit = new Set<string>();
  private bossStarted = false;
  private bossDefeated = false;
  private pitCd = 0;
  private lastPrompt: InteractView | null = null;
  private playSecTimer = 0;
  private god = false;
  private lastCpIndex = -1;
  private resizeHandler = () => this.onResize();
  private pausedByMenu = false;
  private fallLockT = 0;
  private bot = false;

  constructor() {
    super('Level');
  }

  init(data: StartData) {
    this.startData = data && data.levelId ? data : { levelId: save.get().levelId, checkpoint: -1 };
  }

  // ======================================================================= create
  create() {
    ensureTextures(this);
    this.level = getLevel(this.startData.levelId);
    const L = this.level;
    this.t = 0;
    this.solids = [];
    this.solidRt = [];
    this.moves.clear();
    this.props = [];
    this.interacts = [];
    this.relics = [];
    this.pickups = [];
    this.hazards = [];
    this.triggers = [];
    this.cps = [];
    this.arenas.clear();
    this.enemies = [];
    this.hittables = [];
    this.lampsLit.clear();
    this.boss = null;
    this.bossStarted = false;
    this.bossDefeated = false;
    this.ending = false;
    this.locked = false;
    this.cine = null;
    this.camLock = null;
    this.camFocus = null;
    this.chase = { active: false, x: 0, ended: false, fade: 0 };
    this.trail = [];
    this.acc = 0;
    this.pausedByMenu = false;
    this.viewW = this.scale.width;

    const sv = save.get();
    this.cameras.main.setBackgroundColor('#05070b');
    this.atmos = new Atmosphere(this, L.theme, this.viewW, L.camRefY, L.rain, true);
    this.computeZoom();
    this.fx = new Fx(this);
    this.hazG = this.add.graphics().setDepth(6);
    this.relicG = this.add.graphics().setDepth(7);
    this.chaseG = this.add.graphics().setDepth(9);

    this.buildSolids();
    this.buildProps();
    this.buildInteracts();
    this.buildRelics();

    this.hazards = L.hazards.map((def) => ({ def }));
    this.triggers = L.triggers.map((def) => ({ def, fired: false }));
    this.cps = L.checkpoints.map((c) => ({ x: c.x, y: c.y, name: c.name, reached: false }));

    // Debt system
    this.debt = new ShadowDebt();
    this.debt.set(Math.min(sv.debt, 60));

    // Player
    const cpIdx = this.startData.checkpoint ?? -1;
    const spawn = cpIdx >= 0 && L.checkpoints[cpIdx] ? { x: L.checkpoints[cpIdx].x, y: L.checkpoints[cpIdx].y } : L.spawn;
    for (let i = 0; i <= cpIdx; i++) if (this.cps[i]) this.cps[i].reached = true;
    this.lastCpIndex = cpIdx;
    this.player = new Player(this, spawn.x, spawn.y, sv.maxHealth, sv.maxHealth, sv.abilities);
    this.player.bind(this);
    this.player.invuln = 0.8;
    this.hittables = [];

    // Pre-placed enemies (arena enemies are spawned on demand)
    for (const e of L.enemies) if (!e.arena) this.addEnemy(e);

    // Camera
    this.camX = clamp(spawn.x - this.vw * 0.4, 0, Math.max(0, L.width - this.vw));
    this.camY = spawn.y - this.vh * 0.62;
    this.applyCamera(0);

    // HUD
    hud.show();
    hud.setHealth(this.player.hp, this.player.maxHp);
    hud.setDebt(this.debt.value, this.debt.stage);
    this.updateRelicHud();
    this.debt.onChange((v, s) => {
      hud.setDebt(v, s);
      this.atmos.setDebt(v);
    });
    this.atmos.setDebt(this.debt.value);
    touch.setActive(true);
    touch.setAbilities(sv.abilities);
    menus.hideAll();

    audio.setMood(L.mood);
    audio.setDuck(1);
    audio.unlock();

    this.scale.on('resize', this.resizeHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    hud.fadeNow(true);
    this.time.delayedCall(60, () => {
      hud.fade(false, 900);
      if (cpIdx < 0) hud.title(L.title, L.subtitle, 3.8);
    });

    // Debug hooks for automated testing (?debug in the URL).
    if (new URLSearchParams(location.search).has('debug')) this.installDebug();
  }

  private cleanup() {
    this.scale.off('resize', this.resizeHandler);
    this.atmos?.destroy();
    this.debt.clearListeners();
    touch.setActive(false);
    input.releaseAll();
    hud.hide();
    audio.setDuck(1);
  }

  private onResize() {
    this.viewW = this.scale.width;
    this.atmos?.resize(this.viewW);
    this.computeZoom();
  }

  // ===================================================================== building
  private buildSolids() {
    this.level.solids.forEach((d, i) => {
      const kind = d.kind ?? 'solid';
      const s: Solid = {
        id: d.id, x: d.x, y: d.y, w: d.w, h: d.h, kind,
        active: kind === 'shadow' ? false : d.style === 'gate' ? d.closed === true : true,
        dx: 0, dy: 0, baseX: d.x, baseY: d.y, crumble: -1, fallen: 0,
      };
      const g = this.add.graphics().setDepth(d.style === 'gate' ? 5 : 1);
      if (kind === 'shadow') drawShadowBridge(g, d.w);
      else drawSolid(g, d, this.level.theme, 1000 + i * 7);
      g.setPosition(d.x, d.y);
      if (d.style === 'gate' && !s.active) g.setVisible(false);
      this.solids.push(s);
      this.solidRt.push({ solid: s, def: d, g, tilt: 0 });
      if (d.move) this.moves.set(s, { dx: d.move.dx, dy: d.move.dy, period: d.move.period, phase: d.move.phase ?? 0 });
    });
  }

  private buildProps() {
    this.level.props.forEach((p, i) => this.props.push(makeProp(this, p, this.level.theme, 77 + i)));
  }

  private buildInteracts() {
    for (const d of this.level.interacts) {
      const g = this.add.graphics().setDepth(3);
      g.setPosition(d.x, d.y);
      const glow = this.add.image(d.x, d.y - 40, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(3.5).setAlpha(0.5);
      const v: InteractView = { def: d, g, glow, lit: false, used: false };
      if (d.type === 'pickupBlade' && save.get().abilities.blade) v.used = true;
      if (d.type === 'altarShadow' && save.get().abilities.shadowDash) v.used = true;
      drawInteract(v, this.level.theme);
      this.interacts.push(v);
    }
  }

  private buildRelics() {
    const have = new Set(save.get().relics);
    for (const r of this.level.relics) this.relics.push({ def: r, got: have.has(r.id), t: Math.random() * 6 });
  }

  private addEnemy(spawn: EnemySpawn): Enemy {
    const e = createEnemy(this, this, spawn);
    this.enemies.push(e);
    this.hittables.push(e);
    return e;
  }

  // ==================================================================== IWorld API
  hitPlayer(info: HitInfo): string {
    return this.player.hurt(info);
  }

  toast(text: string, time = 3.5) {
    hud.toast(text, time);
  }

  spawnPickup(x: number, y: number, _kind: 'ember') {
    this.pickups.push({ x, y, t: 0, got: false });
  }

  onParry(target: Hittable | null) {
    session.parries++;
    target?.parried();
    this.atmos.flash(0.2);
  }

  onEnemyKilled(e: Hittable) {
    session.kills++;
    if (e.isBoss) return;
    // arena progress is checked in update
  }

  playerDied() {
    if (this.ending) return;
    this.ending = true;
    const sv = save.get();
    sv.deaths++;
    save.flush();
    audio.setMood('sorrow');
    hud.fade(true, 900).then(() => {
      hud.hide();
      touch.setActive(false);
      menus.showGameOver({
        onRetry: () => {
          menus.hideAll();
          this.restartFromCheckpoint();
        },
        onMenu: () => {
          menus.hideAll();
          flow.toMenu();
        },
      });
    });
  }

  // ====================================================================== flow
  restartFromCheckpoint() {
    const sv = save.get();
    const cp = sv.levelId === this.level.id ? sv.checkpoint : -1;
    if (this.scene.isPaused()) this.scene.resume();
    this.scene.restart({ levelId: this.level.id, checkpoint: cp });
  }

  canPause() {
    return !this.ending && !this.cine && !this.locked && this.player && !this.player.dead;
  }

  pauseGame() {
    if (this.scene.isPaused()) return;
    input.releaseAll();
    this.scene.pause();
    this.pausedByMenu = true;
    audio.setDuck(0.3);
    touch.setActive(false);
    menus.showPause({
      onResume: () => this.resumeGame(),
      onRestart: () => {
        menus.hideAll();
        this.resumeGame(true);
        this.ending = true;
        hud.fade(true, 400).then(() => this.restartFromCheckpoint());
      },
      onMenu: () => {
        menus.hideAll();
        this.scene.resume();
        flow.toMenu();
      },
    });
  }

  resumeGame(silent = false) {
    if (!this.scene.isPaused()) return;
    if (!silent) menus.hideAll();
    this.scene.resume();
    this.pausedByMenu = false;
    audio.setDuck(1);
    touch.setActive(true);
    input.releaseAll();
  }

  private async completeLevel() {
    if (this.ending) return;
    this.ending = true;
    this.locked = true;
    const L = this.level;
    const sv = save.get();
    const idx = levelIndex(L.id);
    const next = LEVELS[idx + 1];
    sv.playSeconds += this.playSecTimer;
    this.playSecTimer = 0;
    if (next && next.chapter === L.chapter) {
      // Same chapter, next part: seamless transition.
      sv.levelId = next.id;
      sv.chapter = next.chapter;
      sv.checkpoint = -1;
      sv.debt = this.debt.value;
      save.flush();
      await hud.fade(true, 900);
      this.scene.restart({ levelId: next.id, checkpoint: -1 });
      return;
    }
    // Chapter complete.
    sv.unlockedChapter = Math.max(sv.unlockedChapter, Math.min(3, L.chapter + 1));
    sv.levelId = next ? next.id : L.id;
    sv.chapter = next ? next.chapter : L.chapter;
    sv.checkpoint = -1;
    sv.debt = this.debt.value;
    save.flush();
    audio.setMood('sorrow');
    await hud.fade(true, 900);
    hud.hide();
    touch.setActive(false);
    const chapLevels = LEVELS.filter((l) => l.chapter === L.chapter);
    const relicTotal = chapLevels.reduce((a, l) => a + l.relicTotal, 0);
    const relicGot = sv.relics.filter((id) => chapLevels.some((l) => id.startsWith(l.id + '_'))).length;
    const titles = ['', 'The Broken Order', 'The Drowned Village', 'Beneath the Earth'];
    menus.showComplete(
      {
        chapter: L.chapter, title: titles[L.chapter] ?? L.subtitle,
        time: sv.playSeconds - session.chapterStartSeconds, deaths: sv.deaths - session.chapterStartDeaths,
        relics: relicGot, relicTotal, kills: session.kills, parries: session.parries,
        hasNext: !!next, final: !next,
      },
      {
        onContinue: () => {
          menus.hideAll();
          session.reset(sv.playSeconds, sv.deaths);
          this.scene.restart({ levelId: next!.id, checkpoint: -1 });
        },
        onReplay: () => {
          menus.hideAll();
          const first = chapLevels[0];
          session.reset(sv.playSeconds, sv.deaths);
          sv.levelId = first.id;
          sv.checkpoint = -1;
          save.flush();
          this.scene.restart({ levelId: first.id, checkpoint: -1 });
        },
        onMenu: () => {
          menus.hideAll();
          flow.toMenu();
        },
      },
    );
  }

  // ====================================================================== update
  update(_time: number, delta: number) {
    const realDt = Math.min(delta / 1000, 0.1);
    this.fx.update(realDt);
    hud.tick(realDt);
    if (!this.ending) this.playSecTimer += realDt;

    const frozen = this.fx.hitstop > 0;
    if (!frozen) {
      this.acc += realDt * this.fx.timeScale;
      const STEP = 1 / 60;
      let n = 0;
      while (this.acc >= STEP && n < 5) {
        this.step(STEP);
        this.acc -= STEP;
        n++;
      }
      if (n === 5) this.acc = 0;
    }

    this.updateCamera(realDt);
    this.render(realDt);
    this.atmos.update(realDt, this.camX, this.camY);
    this.updateHud();
  }

  // ------------------------------------------------------------------ sim step
  private step(dt: number) {
    this.t += dt;
    const p = this.player;
    if (this.bot) this.runBot();
    if (this.locked || this.cine) {
      input.releaseAll();
    }

    // Shadow bridges appear with debt.
    const reveal = this.debt.value >= REVEAL_THRESHOLD;
    for (const rt of this.solidRt) {
      if (rt.solid.kind === 'shadow') rt.solid.active = reveal;
    }
    updateSolids(this.solids, dt, this.t, this.moves);

    p.update(dt, this);
    this.trailT -= dt;
    if (this.chase.active && this.trailT <= 0) {
      this.trailT = 0.03;
      this.trail.push({ x: p.cx, y: p.feetY });
      if (this.trail.length > 400) this.trail.shift();
    }

    for (const e of this.enemies) e.update(dt);
    if (this.boss) this.boss.update(dt);
    // Remove finished corpses.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && (e as any).fadeT > 2.2) {
        e.destroy();
        this.enemies.splice(i, 1);
        this.hittables = this.hittables.filter((h) => h !== e);
      }
    }

    this.updateHazards(dt);
    this.updateCollectibles(dt);
    this.updateTriggers();
    this.updateCheckpoints();
    this.updateInteract();
    this.updateChase(dt);
    this.updateArenas();
    this.updateCine(dt);

    // Fell into a pit / off the world.
    this.pitCd = Math.max(0, this.pitCd - dt);
    if (!p.dead && p.body.y > this.level.height + 60 && this.pitCd <= 0) this.respawnFall();

    if (this.god) {
      p.hp = p.maxHp;
      p.dead = false;
    }
  }

  private respawnFall() {
    this.pitCd = 1;
    this.fx.shake(3, 0.2);
    if (this.chase.active) {
      // Never respawn the player behind the pursuers.
      const safe = this.player.lastSafe;
      if (safe.x < this.chase.x + 200) this.chase.x = safe.x - 460;
    }
    this.player.fallRespawn(this);
  }

  // ---------------------------------------------------------------- hazards
  private hazardPhase(h: HazardDef): { active: boolean; warn: boolean; k: number } {
    const period = h.period ?? 3;
    const cyc = (((this.t / period) + (h.phase ?? 0)) % 1 + 1) % 1;
    const act = h.active ?? 0.5;
    const active = cyc < act;
    const warn = !active && cyc > 1 - 0.26;
    return { active, warn, k: cyc / act };
  }

  private updateHazards(_dt: number) {
    const p = this.player;
    if (p.dead) return;
    const pb = p.hurtbox();
    for (const hz of this.hazards) {
      const h = hz.def;
      if (h.x > p.cx + 600 || h.x + h.w < p.cx - 600) continue;
      if (h.kind === 'pit') {
        if (overlap(pb, h) && this.pitCd <= 0) this.respawnFall();
        continue;
      }
      let live = true;
      if (h.kind !== 'spikes') {
        const ph = this.hazardPhase(h);
        live = ph.active;
        // dust / sparks while warning
        if (ph.warn && Math.random() < 0.25) {
          if (h.kind === 'ashfall') this.fx.dust(h.x + h.w / 2 + (Math.random() - 0.5) * h.w, h.y + 4, 1);
          else this.fx.amber(h.x + h.w / 2, h.y + h.h, 1);
        }
      }
      if (!live) continue;
      if (overlap(pb, h) && p.invuln <= 0) {
        p.hurt(hitInfo({
          damage: h.damage ?? 15, dir: sign(p.cx - (h.x + h.w / 2)) === 0 ? 1 : (sign(p.cx - (h.x + h.w / 2)) as 1 | -1),
          knock: 260, knockUp: 260, stun: 0.4, heavy: false, unblockable: true, source: 'hazard', ox: p.cx, oy: p.feetY - 20,
        }));
      }
    }
  }

  // ---------------------------------------------------------- relics & pickups
  private updateCollectibles(dt: number) {
    const p = this.player;
    if (p.dead) return;
    const px = p.cx;
    const py = p.body.y + p.body.h / 2;
    for (const r of this.relics) {
      r.t += dt;
      if (r.got) continue;
      if (Math.abs(r.def.x - px) < 30 && Math.abs(r.def.y - py) < 40) {
        r.got = true;
        const sv = save.get();
        if (!sv.relics.includes(r.def.id)) sv.relics.push(r.def.id);
        save.flush();
        audio.sfx('relic');
        this.fx.ring(r.def.x, r.def.y, PAL.amberHot, 1.6, 0.6);
        this.fx.amber(r.def.x, r.def.y, 16);
        this.atmos.flash(0.12);
        this.updateRelicHud();
        hud.toast('Relic fragment recovered', 2.5);
      }
    }
    for (const k of this.pickups) {
      if (k.got) continue;
      k.t += dt;
      if (Math.abs(k.x - px) < 34 && Math.abs(k.y - py) < 44) {
        k.got = true;
        this.debt.reduce(8);
        p.heal(6);
        audio.sfx('pickup');
        this.fx.amber(k.x, k.y, 8);
      }
    }
    this.pickups = this.pickups.filter((k) => !k.got && k.t < 40);
  }

  private updateRelicHud() {
    const L = this.level;
    const have = save.get().relics.filter((id) => id.startsWith(L.id + '_')).length;
    hud.setRelics(have, L.relicTotal);
  }

  // ----------------------------------------------------------------- triggers
  private updateTriggers() {
    const p = this.player;
    if (p.dead) return;
    const pb = { x: p.cx - 4, y: p.body.y, w: 8, h: p.body.h };
    for (const tr of this.triggers) {
      if (tr.fired && tr.def.once) continue;
      if (!overlap(pb, tr.def)) continue;
      const a = tr.def.action;
      if (a.type === 'end' && this.level.boss && !this.bossDefeated) continue;
      tr.fired = true;
      this.runAction(a, tr.def);
    }
  }

  private runAction(a: TriggerDef['action'], def: TriggerDef) {
    switch (a.type) {
      case 'toast': hud.toast(a.text, a.time ?? 4); break;
      case 'title': hud.title(a.title, a.sub, 3.6); break;
      case 'mood': audio.setMood(a.mood); break;
      case 'hint': hud.toast(HINTS[a.key], 6.5); break;
      case 'chaseStart':
        this.chase = { active: true, x: def.x - 440, ended: false, fade: 0 };
        this.trail = [];
        hud.toast('Run!', 1.6);
        audio.sfx('bell');
        this.fx.shake(3, 0.5);
        break;
      case 'chaseEnd':
        if (this.chase.active) {
          this.chase.active = false;
          this.chase.ended = true;
          hud.toast('The pursuers falter at the broken bridge.', 3.2);
          audio.sfx('thud');
        }
        break;
      case 'arenaStart': this.startArena(a.arena, a.lock, a.gates ?? []); break;
      case 'bossStart': this.startBoss(); break;
      case 'cinematic': this.playLines(a.lines, a.hold ?? 3); break;
      case 'end': void this.completeLevel(); break;
    }
  }

  // ------------------------------------------------------------- checkpoints
  private updateCheckpoints() {
    const p = this.player;
    if (p.dead) return;
    this.cps.forEach((c, i) => {
      if (c.reached) return;
      if (Math.abs(p.cx - c.x) < 60 && Math.abs(p.feetY - c.y) < 90) this.reachCheckpoint(i);
    });
  }

  private reachCheckpoint(i: number, quiet = false) {
    const c = this.cps[i];
    c.reached = true;
    if (i <= this.lastCpIndex) return;
    this.lastCpIndex = i;
    const sv = save.get();
    sv.levelId = this.level.id;
    sv.chapter = this.level.chapter;
    sv.checkpoint = i;
    sv.debt = this.debt.value;
    sv.playSeconds += this.playSecTimer;
    this.playSecTimer = 0;
    save.flush();
    if (!quiet) {
      hud.toast(`Checkpoint · ${c.name}`, 2.6);
      audio.sfx('checkpoint');
      this.fx.ring(c.x, c.y - 40, PAL.amberHot, 1.6, 0.6);
    }
  }

  // --------------------------------------------------------------- interactions
  private updateInteract() {
    const p = this.player;
    let best: InteractView | null = null;
    let bd = 1e9;
    if (!p.dead && !this.locked && !this.cine) {
      for (const v of this.interacts) {
        const dx = Math.abs(v.def.x - p.cx);
        const dy = Math.abs(v.def.y - p.feetY);
        if (dx < 62 && dy < 90 && dx < bd && this.canUse(v)) {
          best = v;
          bd = dx;
        }
      }
    }
    if (best !== this.lastPrompt) {
      this.lastPrompt = best;
      if (!best) {
        hud.prompt(null);
        touch.setUse(false);
      } else {
        hud.prompt(this.promptFor(best), input.label('interact'));
        touch.setUse(true);
      }
    }
    if (best && input.consume('interact', 150)) this.useInteract(best);
  }

  private canUse(v: InteractView): boolean {
    const d = v.def;
    switch (d.type) {
      case 'rest': return !v.used;
      case 'lore': return true;
      case 'pickupBlade': return !v.used;
      case 'altarShadow': return !v.used;
      case 'lamp': return !v.lit;
      case 'shrineGift': return !v.used && this.shrineOpen();
      default: return false;
    }
  }

  private shrineOpen() {
    const gate = this.solids.find((s) => s.id === 'shrineGate');
    return !gate || !gate.active;
  }

  private promptFor(v: InteractView): string {
    const d = v.def;
    if (d.prompt) return d.prompt;
    if (d.type === 'rest') return 'Rest at the lamp';
    return 'Interact';
  }

  private useInteract(v: InteractView) {
    const d = v.def;
    const sv = save.get();
    const p = this.player;
    switch (d.type) {
      case 'rest': {
        v.used = true;
        p.heal(p.maxHp);
        const before = this.debt.value;
        this.debt.reduce(50);
        audio.sfx('checkpoint');
        this.fx.ring(d.x, d.y - 60, PAL.amberHot, 2, 0.7);
        this.fx.embers(d.x, d.y - 60, 14);
        const idx = this.cps.findIndex((c) => Math.abs(c.x - d.x) < 30);
        if (idx >= 0) {
          this.cps[idx].reached = false;
          this.lastCpIndex = Math.min(this.lastCpIndex, idx - 1);
          this.reachCheckpoint(idx, true);
        }
        sv.debt = this.debt.value;
        save.flush();
        hud.toast(before > 0 ? 'You rest. The lamp takes some of your debt.' : 'You rest by the flame.', 3);
        break;
      }
      case 'lore': {
        v.used = true;
        audio.sfx('pickup');
        hud.toast(`<b style="color:#ffd27a">${d.title ?? 'Inscription'}</b><br>${(d.text ?? []).join('<br>')}`, 9);
        break;
      }
      case 'pickupBlade': {
        v.used = true;
        sv.abilities.blade = true;
        p.abilities.blade = true;
        save.flush();
        touch.setAbilities(sv.abilities);
        audio.sfx('pickup');
        this.fx.ring(d.x + 16, d.y - 26, PAL.moon, 1.6, 0.6);
        hud.toast(`${(d.text ?? []).join('<br>')}`, 5);
        this.time.delayedCall(5200, () => hud.toast(HINTS.combat, 7));
        break;
      }
      case 'altarShadow': {
        v.used = true;
        sv.abilities.shadowDash = true;
        p.abilities.shadowDash = true;
        save.flush();
        touch.setAbilities(sv.abilities);
        this.fx.slowmo(0.3, 1.2);
        this.fx.shake(6, 0.8);
        this.fx.ring(d.x, d.y - 52, PAL.shadow, 3.5, 0.9);
        this.fx.violet(d.x, d.y - 52, 28);
        this.atmos.flash(0.5);
        audio.sfx('shadow');
        audio.sfx('bell');
        hud.title(d.title ?? 'The Relic Awakens', 'Shadow Dash unlocked', 4);
        this.time.delayedCall(2200, () => hud.toast(HINTS.shadow + '<br>' + HINTS.debt, 9));
        break;
      }
      case 'lamp': {
        v.lit = true;
        audio.sfx('checkpoint');
        this.fx.embers(d.x, d.y - 40, 10);
        this.fx.ring(d.x, d.y - 44, PAL.amberHot, 1.4, 0.6);
        if (d.group) {
          this.lampsLit.add(d.id);
          const need = d.need ?? 3;
          const total = [...this.lampsLit].length;
          if (total >= need && d.opens) {
            this.openGate(d.opens);
            hud.toast('The third lamp burns. Far away, a stone gate grinds open.', 4.5);
            this.fx.shake(5, 0.8);
            audio.sfx('slam');
          } else hud.toast(`Lamp lit · ${total} / ${need}`, 2.5);
        }
        break;
      }
      case 'shrineGift': {
        v.used = true;
        p.maxHp += 20;
        p.hp = p.maxHp;
        sv.maxHealth = p.maxHp;
        this.debt.set(0);
        sv.debt = 0;
        save.flush();
        audio.sfx('relic');
        this.fx.ring(d.x, d.y - 60, PAL.moon, 4, 1);
        this.atmos.flash(0.3);
        hud.title(d.title ?? 'Shrine', '+20 maximum health · Debt cleansed', 4);
        hud.toast((d.text ?? []).join('<br>'), 6);
        break;
      }
    }
    drawInteract(v, this.level.theme);
    input.flush('interact');
  }

  // ------------------------------------------------------------------- gates
  private closeGate(id: string) {
    const s = this.solids.find((x) => x.id === id);
    const rt = this.solidRt.find((r) => r.solid === s);
    if (!s || !rt) return;
    s.active = true;
    rt.g.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: rt.g, alpha: 1, duration: 500 });
    audio.sfx('slam', 0.8);
    this.fx.shake(3, 0.3);
    this.fx.dust(s.x + s.w / 2, s.y + s.h, 8);
  }

  private openGate(id: string) {
    const s = this.solids.find((x) => x.id === id);
    const rt = this.solidRt.find((r) => r.solid === s);
    if (!s || !rt) return;
    s.active = false;
    this.tweens.add({ targets: rt.g, alpha: 0, y: rt.g.y - 40, duration: 700, onComplete: () => { rt.g.setVisible(false).setAlpha(1).setY(s.y); } });
    this.fx.dust(s.x + s.w / 2, s.y + s.h, 8);
  }

  // ------------------------------------------------------------------- arenas
  private startArena(id: string, lock: [number, number], gates: string[]) {
    if (this.arenas.has(id)) return;
    const arena: Arena = { id, enemies: [], gates, lock, done: false };
    this.arenas.set(id, arena);
    for (const g of gates) this.closeGate(g);
    this.camLock = lock;
    audio.setMood('tense');
    audio.sfx('bell');
    hud.toast('The way is sealed. Defeat them all.', 3);
    for (const e of this.level.enemies) if (e.arena === id) arena.enemies.push(this.addEnemy(e));
    // dramatic entrance
    this.fx.shake(3, 0.3);
  }

  private updateArenas() {
    for (const a of this.arenas.values()) {
      if (a.done) continue;
      if (a.enemies.length && a.enemies.every((e) => e.dead)) {
        a.done = true;
        for (const g of a.gates) this.openGate(g);
        this.camLock = null;
        audio.setMood(this.level.mood === 'sorrow' ? 'sorrow' : 'calm');
        hud.toast('The way opens.', 2.6);
        audio.sfx('checkpoint');
        this.fx.slowmo(0.4, 0.5);
      }
    }
  }

  // --------------------------------------------------------------------- boss
  private startBoss() {
    if (this.bossStarted || !this.level.boss) return;
    this.bossStarted = true;
    const B = this.level.boss;
    for (const g of B.gates) this.closeGate(g);
    this.camLock = [B.arena[0], B.arena[1]];
    const boss = new Boss(this, this, B.x, B.y, B.arena);
    this.boss = boss;
    this.hittables.push(boss);
    boss.onPhase = (n) => {
      if (n === 2) {
        hud.toast('The Guardian\'s chains shatter. It moves faster.', 3);
        audio.setMood('boss');
      } else if (n === 3) {
        hud.toast('Ash rains from the dark above. Watch the markers!', 3.4);
      }
    };
    boss.onDefeated = () => {
      this.bossDefeated = true;
      this.locked = true;
      hud.hideBoss();
      this.time.delayedCall(2600, () => {
        this.locked = false;
        for (const g of B.gates) this.openGate(g);
        this.camLock = null;
        audio.setMood('sorrow');
        this.playLines([
          'The Ashen Guardian kneels, and the ash falls from him like a sleeping thought.',
          '"I guarded the door," he breathes. "Not the treasure behind it."',
          'The relic is warm. Somewhere below, something answers.',
        ], 3.4);
      });
    };
    // Cinematic introduction.
    this.locked = true;
    this.camFocus = { x: B.x, y: B.y - 90 };
    hud.letterbox(true);
    audio.setMood('boss');
    audio.sfx('roar');
    this.fx.shake(5, 1.2);
    hud.title(BOSS_NAME, 'Bound to the first sanctum', 4);
    this.time.delayedCall(3400, () => {
      this.camFocus = null;
      this.locked = false;
      hud.letterbox(false);
      boss.awaken();
    });
  }

  // ----------------------------------------------------------------- cinematic
  private playLines(lines: string[], hold: number) {
    this.cine = { lines, hold, i: 0, t: -0.8 };
    hud.letterbox(true);
    this.player.body.vx *= 0.5;
  }

  private updateCine(dt: number) {
    const c = this.cine;
    if (!c) return;
    c.t += dt;
    if (c.t >= 0 && c.i < c.lines.length) {
      if (c.t < 0.02) hud.subtitleText(c.lines[c.i]);
      const dur = c.hold + c.lines[c.i].length * 0.03;
      if (c.t >= dur) {
        c.t = -0.6;
        hud.subtitleText(null);
        c.i++;
      }
    }
    if (c.i >= c.lines.length && c.t >= -0.2) {
      this.cine = null;
      hud.letterbox(false);
      hud.subtitleText(null);
    }
  }

  // --------------------------------------------------------------------- chase
  private updateChase(dt: number) {
    const c = this.chase;
    const p = this.player;
    if (!c.active) {
      if (c.ended && c.fade < 4) c.fade += dt;
      return;
    }
    const gap = p.cx - c.x;
    const speed = gap > 380 ? 345 : gap < 150 ? 150 : 242;
    c.x += speed * dt;
    // Camera rumble while they close in.
    if (gap < 360 && Math.random() < 0.1) this.fx.shake(1.5, 0.1);
    if (!p.dead && p.cx - 14 < c.x) {
      p.hurt(hitInfo({ damage: 999, dir: 1, knock: 300, knockUp: 200, stun: 0.5, heavy: true, unblockable: true, source: 'hazard', ox: p.cx, oy: p.feetY - 24 }));
      if (!p.dead) p.hp = 0;
    }
  }

  // ===================================================================== render
  private render(realDt: number) {
    const p = this.player;
    p.draw(this);
    for (const e of this.enemies) e.draw();
    this.boss?.draw();
    this.drawSolids();
    this.drawProps(realDt);
    this.drawHazards();
    this.drawCollectibles();
    this.drawChase();
    for (const v of this.interacts) this.animateInteract(v);
  }

  private drawSolids() {
    const x0 = this.camX - 140;
    const x1 = this.camX + this.vw + 140;
    for (const rt of this.solidRt) {
      const s = rt.solid;
      const vis = s.x + s.w > x0 && s.x < x1;
      const g = rt.g;
      if (rt.def.style === 'gate' && !s.active && g.alpha === 1) {
        g.setVisible(false);
        continue;
      }
      g.setVisible(vis && (rt.def.style !== 'gate' || s.active || g.alpha < 1));
      if (!vis) continue;
      if (s.kind === 'moving') g.setPosition(s.x, s.y);
      else if (s.kind === 'crumble') {
        if (!s.active) {
          g.setVisible(false);
        } else if (s.crumble !== undefined && s.crumble > 0) {
          g.setPosition(s.x + (Math.random() - 0.5) * 3, s.y + (Math.random() - 0.5) * 2);
        } else g.setPosition(s.x, s.y);
      } else if (s.kind === 'shadow') {
        g.setAlpha(s.active ? 0.55 + Math.sin(this.t * 4) * 0.2 : 0.0);
        g.setVisible(s.active);
      }
    }
  }

  private drawProps(_dt: number) {
    const x0 = this.camX - 200;
    const x1 = this.camX + this.vw + 200;
    for (const pv of this.props) {
      const vis = pv.x + pv.w > x0 && pv.x < x1;
      pv.g.setVisible(vis);
      if (pv.glow) {
        pv.glow.setVisible(vis);
        if (vis) {
          const f = 0.55 + Math.sin(this.t * 7 + pv.seed) * 0.08 + Math.sin(this.t * 13 + pv.seed * 2) * 0.06;
          pv.glow.setAlpha(pv.kind === 'glyph' ? 0.22 + Math.sin(this.t * 2 + pv.seed) * 0.1 : f);
        }
      }
    }
  }

  private animateInteract(v: InteractView) {
    const d = v.def;
    const vis = Math.abs(d.x - (this.camX + this.vw / 2)) < this.vw / 2 + 160;
    v.g.setVisible(vis);
    v.glow.setVisible(vis && v.glow.alpha > 0);
    if (!vis) return;
    const base = d.type === 'lamp' ? (v.lit ? 0.75 : 0.18) : d.type === 'rest' ? (v.used ? 0.3 : 0.7) : d.type === 'lore' ? (v.used ? 0.1 : 0.4) : d.type === 'pickupBlade' ? (v.used ? 0 : 0.6) : 0.6;
    if (base > 0) v.glow.setAlpha(base + Math.sin(this.t * 6 + d.x) * 0.1);
  }

  private drawHazards() {
    const g = this.hazG;
    g.clear();
    const x0 = this.camX - 120;
    const x1 = this.camX + this.vw + 120;
    for (const hz of this.hazards) {
      const h = hz.def;
      if (h.x + h.w < x0 || h.x > x1) continue;
      if (h.kind === 'pit') {
        if (this.level.theme === 'village') this.drawWater(g, h, x0, x1);
        continue;
      }
      if (h.kind === 'spikes') {
        g.fillStyle(PAL.obsidian, 1);
        const n = Math.max(2, Math.floor(h.w / 12));
        for (let i = 0; i < n; i++) {
          const sx = h.x + (i / n) * h.w;
          g.fillTriangle(sx, h.y + h.h, sx + h.w / n, h.y + h.h, sx + h.w / n / 2, h.y);
        }
        g.lineStyle(1.5, 0xb9c8da, 0.9);
        for (let i = 0; i < n; i++) {
          const sx = h.x + (i / n) * h.w;
          g.beginPath();
          g.moveTo(sx + h.w / n / 2, h.y);
          g.lineTo(sx + h.w / n, h.y + h.h);
          g.strokePath();
        }
        continue;
      }
      const ph = this.hazardPhase(h);
      const cx = h.x + h.w / 2;
      if (h.kind === 'blade') {
        const pivotY = h.y - 190;
        const swing = ph.active ? Math.sin(ph.k * Math.PI * 2) * 0.55 : 0;
        const len = h.h + 190;
        const bx = cx + Math.sin(swing) * len * 0.5;
        const by = pivotY + Math.cos(swing) * len * 0.9;
        const alpha = ph.active ? 1 : ph.warn ? 0.35 + Math.sin(this.t * 40) * 0.2 : 0.18;
        g.lineStyle(2, 0x1a2230, alpha);
        g.beginPath();
        g.moveTo(cx, pivotY);
        g.lineTo(bx, by);
        g.strokePath();
        if (ph.active) {
          g.fillStyle(PAL.obsidian, 1);
          g.fillTriangle(bx - 38, by + 12, bx + 38, by + 12, bx, by - 20);
          g.lineStyle(2, PAL.moon, 0.9);
          g.beginPath();
          g.moveTo(bx - 38, by + 12);
          g.lineTo(bx, by - 20);
          g.lineTo(bx + 38, by + 12);
          g.strokePath();
        } else if (ph.warn) {
          g.lineStyle(2, PAL.crimsonHot, 0.35 + 0.3 * Math.sin(this.t * 30));
          g.strokeRect(h.x, h.y, h.w, h.h);
        }
      } else if (h.kind === 'ashfall') {
        if (ph.active) {
          const fall = Math.min(1, ph.k * 1.6);
          const top = h.y + (h.h - 70) * fall;
          g.fillStyle(PAL.obsidian, 1);
          g.fillRect(h.x + 6, h.y, h.w - 12, top - h.y + 50);
          g.fillStyle(PAL.amber, 0.7);
          g.fillRect(h.x + 4, top + 30, h.w - 8, 28);
          g.fillStyle(PAL.amberHot, 0.9);
          g.fillRect(h.x + 12, top + 40, h.w - 24, 14);
        } else if (ph.warn) {
          const a = 0.2 + 0.4 * Math.abs(Math.sin(this.t * 20));
          g.fillStyle(PAL.crimsonHot, a * 0.35);
          g.fillRect(h.x, h.y + h.h - 20, h.w, 20);
          g.lineStyle(2, PAL.crimsonHot, a);
          g.strokeRect(h.x, h.y + h.h - 20, h.w, 20);
        }
      } else if (h.kind === 'fire') {
        if (ph.active) {
          g.fillStyle(PAL.amber, 0.85);
          g.fillTriangle(h.x, h.y + h.h, h.x + h.w, h.y + h.h, cx, h.y - Math.sin(this.t * 25) * 6);
          g.fillStyle(PAL.amberHot, 1);
          g.fillTriangle(h.x + h.w * 0.25, h.y + h.h, h.x + h.w * 0.75, h.y + h.h, cx, h.y + h.h * 0.4);
        } else if (ph.warn) {
          g.fillStyle(PAL.crimsonHot, 0.3);
          g.fillRect(h.x, h.y + h.h - 8, h.w, 8);
        }
      }
    }
  }

  private drawWater(g: Phaser.GameObjects.Graphics, h: HazardDef, x0: number, x1: number) {
    const a = Math.max(h.x, x0);
    const b = Math.min(h.x + h.w, x1);
    if (b <= a) return;
    const top = h.y;
    g.fillStyle(0x0b1d26, 0.92);
    g.fillRect(a, top, b - a, 420);
    g.fillStyle(0x1d4a58, 0.35);
    g.fillRect(a, top, b - a, 30);
    g.lineStyle(1.5, 0x9fd0dd, 0.45);
    for (let row = 0; row < 3; row++) {
      g.beginPath();
      for (let x = a; x <= b; x += 24) {
        const y = top + row * 9 + Math.sin(this.t * 1.6 + x * 0.045 + row) * 2.2;
        if (x === a) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
    // rain rings
    g.lineStyle(1, 0xcfe8f2, 0.35);
    for (let i = 0; i < 6; i++) {
      const rx = a + ((i * 173 + Math.floor(this.t * 2) * 97) % Math.max(40, b - a));
      const k = (this.t * 1.7 + i * 0.37) % 1;
      g.strokeEllipse(rx, top + 3, 4 + k * 14, 1.5 + k * 3);
    }
  }

  private drawCollectibles() {
    const g = this.relicG;
    g.clear();
    const x0 = this.camX - 60;
    const x1 = this.camX + this.vw + 60;
    for (const r of this.relics) {
      if (r.got || r.def.x < x0 || r.def.x > x1) continue;
      const by = r.def.y + Math.sin(r.t * 2.2) * 5;
      const s = 1 + Math.sin(r.t * 5) * 0.08;
      g.fillStyle(PAL.amber, 0.14);
      g.fillCircle(r.def.x, by, 36 * s);
      g.fillStyle(PAL.amber, 0.28);
      g.fillCircle(r.def.x, by, 20 * s);
      g.fillStyle(PAL.obsidian, 1);
      g.fillTriangle(r.def.x, by - 13, r.def.x + 8, by, r.def.x, by + 13);
      g.fillTriangle(r.def.x, by - 13, r.def.x - 8, by, r.def.x, by + 13);
      g.lineStyle(2, PAL.amberHot, 1);
      g.beginPath();
      g.moveTo(r.def.x, by - 13);
      g.lineTo(r.def.x + 8, by);
      g.lineTo(r.def.x, by + 13);
      g.lineTo(r.def.x - 8, by);
      g.closePath();
      g.strokePath();
    }
    for (const k of this.pickups) {
      if (k.x < x0 || k.x > x1) continue;
      const by = k.y + Math.sin(k.t * 3) * 4;
      g.fillStyle(PAL.amber, 0.25);
      g.fillCircle(k.x, by, 14);
      g.fillStyle(PAL.amberHot, 1);
      g.fillCircle(k.x, by, 4);
    }
  }

  private drawChase() {
    const g = this.chaseG;
    g.clear();
    const c = this.chase;
    if (!c.active && !(c.ended && c.fade < 4)) return;
    const fade = c.active ? 1 : Math.max(0, 1 - c.fade / 3);
    if (fade <= 0) return;
    const top = this.camY - 40;
    const bot = this.camY + this.vh + 40;
    const x = c.x;
    // The wall of shadow.
    g.fillStyle(PAL.obsidian, 0.92 * fade);
    g.fillRect(x - 1400, top, 1400, bot - top);
    for (let i = 0; i < 6; i++) {
      g.fillStyle(PAL.crimson, (0.1 - i * 0.015) * fade);
      g.fillRect(x + i * 10, top, 10, bot - top);
    }
    // Ragged leading edge.
    g.fillStyle(PAL.obsidian, 0.92 * fade);
    for (let y = top; y < bot; y += 22) {
      const off = Math.sin(this.t * 6 + y * 0.05) * 14 + 16;
      g.fillTriangle(x, y, x, y + 22, x + off, y + 11);
    }
    // Pursuers: replay the player's trail slightly behind the wall.
    const styleScale = SENTINEL_STYLE;
    for (let i = 0; i < 5; i++) {
      const px = x - 20 - i * 46;
      let py = this.player.feetY;
      // nearest trail point
      let best = 1e9;
      for (let j = this.trail.length - 1; j >= 0; j -= 3) {
        const d = Math.abs(this.trail[j].x - px);
        if (d < best) {
          best = d;
          py = this.trail[j].y;
        }
        if (this.trail[j].x < px - 200) break;
      }
      if (best > 300) py = this.player.feetY;
      const ph = this.t * 14 + i * 1.7;
      const pose: Pose = neutralPose();
      const amp = 0.75;
      pose.legF = [amp * Math.sin(ph), 0.2 + 0.9 * Math.max(0, Math.cos(ph))];
      pose.legB = [-amp * Math.sin(ph), 0.2 + 0.9 * Math.max(0, -Math.cos(ph))];
      pose.lean = 0.3;
      pose.armF = [1.0, 0.5];
      pose.armB = [-0.6 * Math.sin(ph), 1.0];
      pose.weapon = 1.55;
      drawRig(g, px, py, 1, pose, styleScale, { alpha: 0.95 * fade, eyeGlow: 1, rimAlpha: 0.25 });
    }
  }

  // ===================================================================== camera
  private updateCamera(dt: number) {
    const p = this.player;
    const L = this.level;
    const vw = this.vw;
    const vh = this.vh;
    let tx: number;
    let ty: number;
    if (this.camFocus) {
      tx = this.camFocus.x - vw / 2;
      ty = this.camFocus.y - vh * 0.55;
    } else {
      const speedK = Math.abs(p.body.vx) > 250 ? 1 : 0;
      const look = p.facing * (70 + speedK * 60);
      tx = p.cx + look - vw * 0.5;
      ty = p.feetY - vh * 0.62;
      if (p.state === 'FALL' && p.body.vy > 500) ty += 60; // look down while falling fast
    }
    // Vertical dead zone (ignore small bobs).
    const ddy = ty - this.camY;
    if (!this.camFocus && Math.abs(ddy) < 14 && p.body.onGround) ty = this.camY;
    this.camX = damp(this.camX, tx, this.camFocus ? 2.4 : 7, dt);
    this.camY = damp(this.camY, ty, this.camFocus ? 2.4 : 4.5, dt);
    this.applyCamera(dt);
    void L;
  }

  private applyCamera(_dt: number) {
    const L = this.level;
    const vw = this.vw;
    const vh = this.vh;
    let minX = 0;
    let maxX = Math.max(0, L.width - vw);
    if (this.camLock) {
      minX = this.camLock[0];
      maxX = Math.max(minX, this.camLock[1] - vw);
      if (this.camLock[1] - this.camLock[0] < vw) minX = maxX = (this.camLock[0] + this.camLock[1]) / 2 - vw / 2;
    }
    this.camX = clamp(this.camX, minX, maxX);
    this.camY = clamp(this.camY, -200, L.height - vh + 150);
    this.cameras.main.setScroll(this.camX + vw / 2 - this.viewW / 2 + this.fx.shakeX, this.camY + vh / 2 - VIEW_H / 2 + this.fx.shakeY);
  }

  // ======================================================================== HUD
  private updateHud() {
    const p = this.player;
    hud.setHealth(p.hp, p.maxHp);
    if (this.boss && this.bossStarted && !this.bossDefeated && this.boss.state !== 'DORMANT') hud.setBoss(BOSS_NAME, this.boss.hp, BOSS_MAX_HP);
  }

  /** Debug autopilot (only reachable with ?debug): runs right, jumps gaps/walls, slides under beams. */
  private runBot() {
    const p = this.player;
    const b = p.body;
    const cx = p.cx;
    const feet = p.feetY;
    const solidAt = (x: number, y: number) => this.solids.some((s) => s.active && s.kind !== 'oneway' && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    const floorAt = (x: number, y: number) => this.solids.some((s) => s.active && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + Math.max(s.h, 14));
    if (p.state === 'WALL') {
      this.botWallDir = p.facing;
      this.botWallT = this.t;
    }
    const climbing = this.t - this.botWallT < 1.0 && !b.onGround;
    input.setVirtual('right', climbing ? this.botWallDir === -1 : true);
    input.setVirtual('left', climbing ? this.botWallDir === 1 : false);
    input.setVirtual('sprint', true);
    let down = false;
    if (b.onGround) {
      const gapAhead = !floorAt(cx + 46, feet + 6) && !floorAt(cx + 70, feet + 6);
      const wallAhead = solidAt(cx + 30, feet - 46);
      const beamAhead = solidAt(cx + 70, feet - 44) && !solidAt(cx + 70, feet - 8);
      if (beamAhead) down = true;
      else if ((gapAhead || wallAhead) && !this.chaseWaitJump) {
        input.setVirtual('jump', true);
        window.setTimeout(() => input.setVirtual('jump', false), 200);
        this.chaseWaitJump = true;
        window.setTimeout(() => (this.chaseWaitJump = false), 350);
      }
    } else if (p.state === 'WALL' && !this.chaseWaitJump) {
      input.setVirtual('jump', true);
      window.setTimeout(() => input.setVirtual('jump', false), 120);
      this.chaseWaitJump = true;
      window.setTimeout(() => (this.chaseWaitJump = false), 260);
    }
    input.setVirtual('down', down);
  }
  private chaseWaitJump = false;
  private botWallDir = 0;
  private botWallT = -10;

  // ===================================================================== debug
  private installDebug() {
    const w = window as any;
    w.__ashva = {
      scene: this,
      player: this.player,
      tp: (x: number, y?: number) => this.player.teleport(x, y ?? this.player.feetY),
      god: (v = true) => (this.god = v),
      debt: (v: number) => this.debt.set(v),
      unlockAll: () => {
        const sv = save.get();
        sv.abilities.blade = true;
        sv.abilities.shadowDash = true;
        this.player.abilities.blade = true;
        this.player.abilities.shadowDash = true;
      },
      state: () => ({
        x: Math.round(this.player.cx), y: Math.round(this.player.feetY), vx: Math.round(this.player.body.vx), vy: Math.round(this.player.body.vy),
        st: this.player.state, hp: this.player.hp, debt: this.debt.value, ground: this.player.body.onGround,
        enemies: this.enemies.filter((e) => !e.dead).length, foes: this.enemies.map((e) => ({ t: e.def.id, st: e.state, hp: Math.round(e.hp), x: Math.round(e.x) })), level: this.level.id, boss: this.boss ? { hp: this.boss.hp, st: this.boss.state, phase: this.boss.phase } : null,
        chase: this.chase.active ? Math.round(this.chase.x) : null, cam: [Math.round(this.camX), Math.round(this.camY)],
      }),
      kill: () => {
        for (const e of this.enemies) if (!e.dead) e.hurt(hitInfo({ damage: 9999, dir: 1, source: 'player', ox: e.x, oy: e.y }));
      },
      hurtBoss: (n: number) => this.boss?.hurt(hitInfo({ damage: n, dir: 1, source: 'player', ox: 0, oy: 0, heavy: true })),
      end: () => this.completeLevel(),
      bot: (v = true) => { this.bot = v; if (!v) { input.setVirtual('right', false); input.setVirtual('sprint', false); input.setVirtual('down', false); } },
    };
    // quick hotkeys
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F2') this.player.heal(999);
      if (e.code === 'F3') this.god = !this.god;
    });
  }
}

// keep helper imports referenced for tree-shaking sanity
void fmt;
void moveBody;
