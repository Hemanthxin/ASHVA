export type Action =
  | 'left' | 'right' | 'up' | 'down'
  | 'jump' | 'sprint' | 'light' | 'heavy' | 'dodge' | 'shadow' | 'interact' | 'block' | 'pause';

const KEYMAP: Record<string, Action> = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  Space: 'jump',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyJ: 'light', KeyK: 'heavy', KeyL: 'dodge', KeyI: 'shadow',
  KeyE: 'interact', KeyU: 'block', Escape: 'pause', KeyP: 'pause',
};
const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'jump', 'sprint', 'light', 'heavy', 'dodge', 'shadow', 'interact', 'block', 'pause'];

/**
 * Unified keyboard + touch input. Keyboard state and virtual (touch) state are tracked
 * separately and OR-ed so a stuck virtual button never blocks the keyboard.
 */
class InputImpl {
  private keys = new Set<Action>();
  private virt = new Set<Action>();
  private pressTime: Record<string, number> = {};
  private consumed: Record<string, boolean> = {};
  /** Analog horizontal axis from the touch stick (-1..1); 0 when unused. */
  stickX = 0;
  lastDevice: 'keyboard' | 'touch' = 'keyboard';
  private pauseHandlers: Array<() => void> = [];
  /** Any-key listeners (used by cinematics to allow skipping). */
  private anyHandlers: Array<() => void> = [];

  constructor() {
    for (const a of ACTIONS) {
      this.pressTime[a] = -1e9;
      this.consumed[a] = true;
    }
  }

  attach() {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const a = KEYMAP[e.code];
      if (!e.repeat) this.anyHandlers.forEach((h) => h());
      if (!a) return;
      e.preventDefault();
      this.lastDevice = 'keyboard';
      if (e.repeat) return;
      this.press(a, this.keys);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      e.preventDefault();
      this.keys.delete(a);
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll());
    // Block page scroll / zoom / context menu on the game surface.
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  private press(a: Action, set: Set<Action>) {
    if (!set.has(a)) {
      set.add(a);
      this.pressTime[a] = performance.now();
      this.consumed[a] = false;
      if (a === 'pause') this.pauseHandlers.forEach((h) => h());
    }
  }

  setVirtual(a: Action, down: boolean) {
    if (down) {
      this.lastDevice = 'touch';
      this.press(a, this.virt);
    } else this.virt.delete(a);
  }

  onPause(h: () => void) {
    this.pauseHandlers.push(h);
  }
  /** Register a one-shot style "any input" listener; returns an unsubscribe function. */
  onAny(h: () => void) {
    this.anyHandlers.push(h);
    return () => {
      this.anyHandlers = this.anyHandlers.filter((x) => x !== h);
    };
  }
  fireAny() {
    this.anyHandlers.forEach((h) => h());
  }

  releaseAll() {
    this.keys.clear();
    this.virt.clear();
    this.stickX = 0;
  }

  isDown(a: Action) {
    return this.keys.has(a) || this.virt.has(a);
  }

  /** -1..1 horizontal intent. */
  get moveX() {
    let x = 0;
    if (this.keys.has('left') || this.virt.has('left')) x -= 1;
    if (this.keys.has('right') || this.virt.has('right')) x += 1;
    if (x === 0) x = this.stickX;
    return x;
  }

  /** True once per physical press if it happened within `bufferMs`. */
  consume(a: Action, bufferMs = 130): boolean {
    if (this.consumed[a]) return false;
    if (performance.now() - this.pressTime[a] <= bufferMs) {
      this.consumed[a] = true;
      return true;
    }
    return false;
  }

  /** Peek without consuming. */
  buffered(a: Action, bufferMs = 130): boolean {
    return !this.consumed[a] && performance.now() - this.pressTime[a] <= bufferMs;
  }

  flush(a?: Action) {
    if (a) this.consumed[a] = true;
    else for (const k of ACTIONS) this.consumed[k] = true;
  }

  /** Keyboard / touch aware label for prompts. */
  label(a: Action): string {
    const touch = this.lastDevice === 'touch';
    const k: Record<Action, [string, string]> = {
      left: ['A / Left', 'stick left'], right: ['D / Right', 'stick right'], up: ['W / Up', 'stick up'], down: ['S / Down', 'stick down'],
      jump: ['Space', 'JUMP'], sprint: ['Shift', 'push stick fully'], light: ['J', 'ATTACK'], heavy: ['K', 'HEAVY'],
      dodge: ['L', 'DODGE'], shadow: ['I', 'SHADOW'], interact: ['E', 'USE'], block: ['U', 'GUARD'], pause: ['Esc', 'II'],
    };
    return k[a][touch ? 1 : 0];
  }
}

export const input = new InputImpl();
