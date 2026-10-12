import { SAVE_KEY, SAVE_VERSION, SETTINGS_KEY } from '../config/gameConfig';

export interface SaveData {
  version: number;
  unlockedChapter: number; // highest chapter reachable (1..3)
  chapter: number; // chapter to resume
  levelId: string; // level (part of a chapter) to resume
  checkpoint: number; // checkpoint index within that chapter
  abilities: { blade: boolean; shadowDash: boolean; wallJump: boolean };
  relics: string[]; // collected key relics (ids)
  maxHealth: number;
  debt: number;
  deaths: number;
  playSeconds: number;
  introSeen: boolean;
}

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  screenShake: boolean;
  reducedFx: boolean;
  touchControls: 'auto' | 'on' | 'off';
}

export const defaultSave = (): SaveData => ({
  version: SAVE_VERSION,
  unlockedChapter: 1,
  chapter: 1,
  levelId: 'c1a',
  checkpoint: -1,
  abilities: { blade: false, shadowDash: false, wallJump: true },
  relics: [],
  maxHealth: 100,
  debt: 0,
  deaths: 0,
  playSeconds: 0,
  introSeen: false,
});

export const defaultSettings = (): Settings => ({
  master: 0.8,
  music: 0.7,
  sfx: 0.9,
  screenShake: true,
  reducedFx: false,
  touchControls: 'auto',
});

const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Validate and migrate arbitrary JSON into a SaveData. Returns null when unusable. */
function sanitizeSave(raw: any): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.version !== 'number' || raw.version > SAVE_VERSION || raw.version < 1) return null;
  const d = defaultSave();
  const a = raw.abilities && typeof raw.abilities === 'object' ? raw.abilities : {};
  return {
    version: SAVE_VERSION,
    unlockedChapter: Math.round(num(raw.unlockedChapter, 1, 1, 3)),
    chapter: Math.round(num(raw.chapter, 1, 1, 3)),
    levelId: typeof raw.levelId === 'string' && ['c1a', 'c1b', 'c2', 'c3'].includes(raw.levelId) ? raw.levelId : 'c1a',
    checkpoint: Math.round(num(raw.checkpoint, -1, -1, 50)),
    abilities: {
      blade: bool(a.blade, d.abilities.blade),
      shadowDash: bool(a.shadowDash, d.abilities.shadowDash),
      wallJump: bool(a.wallJump, true),
    },
    relics: Array.isArray(raw.relics) ? raw.relics.filter((r: unknown) => typeof r === 'string').slice(0, 64) : [],
    maxHealth: num(raw.maxHealth, 100, 50, 300),
    debt: num(raw.debt, 0, 0, 100),
    deaths: Math.round(num(raw.deaths, 0, 0, 99999)),
    playSeconds: num(raw.playSeconds, 0, 0, 1e9),
    introSeen: bool(raw.introSeen, false),
  };
}

function sanitizeSettings(raw: any): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  return {
    master: num(raw.master, d.master, 0, 1),
    music: num(raw.music, d.music, 0, 1),
    sfx: num(raw.sfx, d.sfx, 0, 1),
    screenShake: bool(raw.screenShake, d.screenShake),
    reducedFx: bool(raw.reducedFx, d.reducedFx),
    touchControls: raw.touchControls === 'on' || raw.touchControls === 'off' ? raw.touchControls : 'auto',
  };
}

function readJson(key: string): any {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable (private mode / quota) - game stays playable */
  }
}

class SaveSystemImpl {
  settings: Settings = sanitizeSettings(readJson(SETTINGS_KEY));
  data: SaveData | null = sanitizeSave(readJson(SAVE_KEY));
  private listeners: Array<() => void> = [];

  hasSave() {
    return this.data !== null;
  }
  newGame(): SaveData {
    this.data = defaultSave();
    this.flush();
    return this.data;
  }
  /** Current save, creating a fresh one when none exists. */
  get(): SaveData {
    return this.data ?? this.newGame();
  }
  flush() {
    if (this.data) writeJson(SAVE_KEY, this.data);
  }
  erase() {
    this.data = null;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }
  saveSettings() {
    writeJson(SETTINGS_KEY, this.settings);
    this.listeners.forEach((l) => l());
  }
  /** Subscribe to settings changes; returns an unsubscribe function. */
  onSettings(fn: () => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
}

export const save = new SaveSystemImpl();
