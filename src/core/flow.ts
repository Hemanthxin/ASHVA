import type Phaser from 'phaser';

/**
 * Tiny scene-flow registry so scenes and DOM menus can navigate without importing each other.
 * Populated by main.ts.
 */
export interface Flow {
  game: Phaser.Game | null;
  startNew(): void;
  continueGame(): void;
  playIntro(then: 'game' | 'menu'): void;
  toMenu(): void;
  startLevel(levelId: string, checkpoint: number): void;
  togglePause(): void;
}

export const flow: Flow = {
  game: null,
  startNew: () => {},
  continueGame: () => {},
  playIntro: () => {},
  toMenu: () => {},
  startLevel: () => {},
  togglePause: () => {},
};

/** Cross-level counters for the chapter summary (not persisted). */
export const session = {
  chapterStartSeconds: 0,
  chapterStartDeaths: 0,
  kills: 0,
  parries: 0,
  reset(playSeconds: number, deaths: number) {
    this.chapterStartSeconds = playSeconds;
    this.chapterStartDeaths = deaths;
    this.kills = 0;
    this.parries = 0;
  },
};
