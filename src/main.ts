import Phaser from 'phaser';
import './ui/style.css';
import { VIEW_H, VIEW_MAX_W, VIEW_MIN_W } from './config/gameConfig';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { IntroScene } from './scenes/IntroScene';
import { LevelScene } from './scenes/LevelScene';
import { input } from './systems/InputSystem';
import { audio } from './systems/AudioSystem';
import { save } from './systems/SaveSystem';
import { hud } from './ui/HUD';
import { menus } from './ui/Menus';
import { touch } from './ui/TouchControls';
import { flow, session } from './core/flow';
import { getLevel } from './data/levels';

/** Logical width follows the window aspect ratio (height is fixed) so phones use their whole screen. */
function viewWidth() {
  const a = window.innerWidth / Math.max(1, window.innerHeight);
  return Math.round(Math.min(VIEW_MAX_W, Math.max(VIEW_MIN_W, VIEW_H * a)));
}

function boot() {
  input.attach();
  const overlay = document.getElementById('overlay-root')!;
  hud.mount(overlay);
  touch.mount(overlay);
  menus.mount(overlay);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#05070b',
    width: viewWidth(),
    height: VIEW_H,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, powerPreference: 'high-performance', batchSize: 4096, roundPixels: false },
    fps: { target: 60, smoothStep: true },
    input: { activePointers: 4, keyboard: false, mouse: false, touch: false, gamepad: false },
    disableContextMenu: true,
    banner: false,
    scene: [BootScene, MenuScene, IntroScene, LevelScene],
  });
  flow.game = game;

  window.addEventListener('resize', () => {
    const w = viewWidth();
    if (game.scale.width !== w) game.scale.setGameSize(w, VIEW_H);
    game.scale.refresh();
  });

  const stopAll = () => {
    for (const k of ['Menu', 'Intro', 'Level']) if (game.scene.isActive(k) || game.scene.isPaused(k)) game.scene.stop(k);
  };

  flow.toMenu = () => {
    menus.hideAll();
    hud.fadeNow(true);
    stopAll();
    game.scene.start('Menu');
  };
  flow.playIntro = (then) => {
    menus.hideAll();
    stopAll();
    game.scene.start('Intro', { then });
  };
  flow.startLevel = (levelId, checkpoint) => {
    menus.hideAll();
    stopAll();
    game.scene.start('Level', { levelId, checkpoint });
  };
  flow.startNew = () => {
    save.newGame();
    const sv = save.get();
    session.reset(sv.playSeconds, sv.deaths);
    // The cinematic always plays on a brand new game.
    flow.playIntro('game');
  };
  flow.continueGame = () => {
    const sv = save.get();
    getLevel(sv.levelId); // validates id (falls back to first level)
    session.reset(sv.playSeconds, sv.deaths);
    flow.startLevel(sv.levelId, sv.checkpoint);
  };
  flow.togglePause = () => {
    const lvl = game.scene.getScene('Level') as LevelScene;
    if (!lvl) return;
    const paused = game.scene.isPaused('Level');
    if (paused && menus.currentId === 'pause') lvl.resumeGame();
    else if (game.scene.isActive('Level') && !menus.isOpen && lvl.canPause()) lvl.pauseGame();
  };
  input.onPause(() => flow.togglePause());
  hud.pauseBtn.addEventListener('click', () => flow.togglePause());

  // Audio must be unlocked by a user gesture.
  const unlock = () => {
    audio.unlock();
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchend', unlock, { passive: true });

  // Pause automatically when the tab is hidden during play.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      const lvl = game.scene.getScene('Level') as LevelScene;
      if (lvl && game.scene.isActive('Level') && lvl.canPause() && !menus.isOpen) lvl.pauseGame();
    }
  });

  // Test hooks (only with ?debug in the URL).
  if (new URLSearchParams(location.search).has('debug')) {
    (window as any).__game = game;
    (window as any).__audio = audio;
  }
}

boot();
