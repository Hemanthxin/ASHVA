import { save } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';

type Fn = () => void;

export function toggleFullscreen() {
  const d: any = document;
  const root: any = document.documentElement;
  const isFs = d.fullscreenElement || d.webkitFullscreenElement;
  try {
    if (!isFs) {
      const p = (root.requestFullscreen || root.webkitRequestFullscreen)?.call(root);
      Promise.resolve(p)
        .then(() => (screen.orientation as any)?.lock?.('landscape'))
        .catch(() => {});
    } else (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
  } catch {
    /* unsupported (e.g. iPhone Safari) - ignore */
  }
}

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
};

export interface CompleteStats {
  chapter: number;
  title: string;
  time: number;
  deaths: number;
  relics: number;
  relicTotal: number;
  kills: number;
  parries: number;
  hasNext: boolean;
  final: boolean;
}

class MenusImpl {
  private root!: HTMLElement;
  private screens: Record<string, HTMLElement> = {};
  private current: string | null = null;
  private backFn: Fn | null = null;
  private settingsBack: Fn | null = null;
  /** Fired whenever a menu screen opens or closes. */
  onVisibility: (open: boolean) => void = () => {};

  mount(parent: HTMLElement) {
    this.root = parent;
    window.addEventListener('keydown', (e) => {
      if (!this.current) return;
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        const btns = Array.from(this.screens[this.current].querySelectorAll<HTMLElement>('.btn:not([disabled])'));
        if (!btns.length) return;
        const i = btns.indexOf(document.activeElement as HTMLElement);
        const next = e.code === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        btns[i < 0 ? 0 : next].focus();
        audio.sfx('ui', 1.2);
        e.preventDefault();
      } else if (e.code === 'Escape' && this.backFn && this.current !== 'pause') {
        this.backFn();
      }
    }, true);
  }

  private make(id: string, html: string, dim = true): HTMLElement {
    let s = this.screens[id];
    if (!s) {
      s = document.createElement('div');
      s.className = 'screen' + (dim ? ' dim' : '');
      s.id = `screen-${id}`;
      this.root.appendChild(s);
      this.screens[id] = s;
    }
    s.innerHTML = html;
    s.querySelectorAll<HTMLElement>('.btn').forEach((b) => {
      b.addEventListener('pointerenter', () => {
        b.focus({ preventScroll: true });
        audio.sfx('hover');
      });
      b.addEventListener('click', () => {
        audio.unlock();
        audio.sfx('ui');
      });
    });
    return s;
  }

  private open(id: string, back: Fn | null = null) {
    for (const k in this.screens) this.screens[k].classList.toggle('on', k === id);
    this.current = id;
    this.backFn = back;
    const first = this.screens[id].querySelector<HTMLElement>('.btn:not([disabled])');
    window.setTimeout(() => first?.focus({ preventScroll: true }), 30);
    this.onVisibility(true);
  }

  hideAll() {
    for (const k in this.screens) this.screens[k].classList.remove('on');
    this.current = null;
    this.backFn = null;
    this.onVisibility(false);
  }

  get isOpen() {
    return this.current !== null;
  }
  get currentId() {
    return this.current;
  }

  // ---------------------------------------------------------------- main menu
  showMain(h: { onNew: Fn; onContinue: Fn; onIntro: Fn; hasSave: boolean; chapterLabel?: string }) {
    const s = this.make('main', `
      <div class="panel">
        <div class="logo"><h1>ASHVA</h1><p>Rise of the Forgotten</p></div>
        <button class="btn" data-a="new">New Game</button>
        <button class="btn" data-a="continue" ${h.hasSave ? '' : 'disabled'}>Continue${h.chapterLabel ? ` <small style="opacity:.6;letter-spacing:.1em">· ${h.chapterLabel}</small>` : ''}</button>
        <button class="btn" data-a="intro">Watch Intro</button>
        <button class="btn" data-a="settings">Settings</button>
        <button class="btn" data-a="credits">Credits</button>
        <button class="btn sub" data-a="fs">Fullscreen</button>
      </div>`, false);
    const on = (a: string, fn: Fn) => s.querySelector(`[data-a=${a}]`)?.addEventListener('click', fn);
    on('new', () => {
      if (save.hasSave()) this.confirm('Starting a new game will erase your saved progress.', h.onNew);
      else h.onNew();
    });
    on('continue', h.onContinue);
    on('intro', h.onIntro);
    on('settings', () => this.showSettings(() => this.showMain(h)));
    on('credits', () => this.showCredits(() => this.showMain(h)));
    on('fs', toggleFullscreen);
    this.open('main');
  }

  // ---------------------------------------------------------------- settings
  showSettings(back: Fn) {
    const st = save.settings;
    const s = this.make('settings', `
      <div class="panel modal">
        <div class="h2">Settings</div>
        <div class="row"><span>Master volume</span><input type="range" min="0" max="100" value="${Math.round(st.master * 100)}" data-k="master"></div>
        <div class="row"><span>Music volume</span><input type="range" min="0" max="100" value="${Math.round(st.music * 100)}" data-k="music"></div>
        <div class="row"><span>Effects volume</span><input type="range" min="0" max="100" value="${Math.round(st.sfx * 100)}" data-k="sfx"></div>
        <div class="row"><span>Screen shake</span><div class="toggle ${st.screenShake ? 'on' : ''}" data-t="screenShake" role="switch"></div></div>
        <div class="row"><span>Reduced visual effects</span><div class="toggle ${st.reducedFx ? 'on' : ''}" data-t="reducedFx" role="switch"></div></div>
        <div class="row"><span>Rain</span>
          <select class="sel" data-s="rain">
            <option value="off" ${st.rain === 'off' ? 'selected' : ''}>Off</option>
            <option value="light" ${st.rain === 'light' ? 'selected' : ''}>Light</option>
            <option value="normal" ${st.rain === 'normal' ? 'selected' : ''}>Heavy</option>
          </select></div>
        <div class="row"><span>Touch controls</span>
          <select class="sel" data-s="touchControls">
            <option value="auto" ${st.touchControls === 'auto' ? 'selected' : ''}>Auto</option>
            <option value="on" ${st.touchControls === 'on' ? 'selected' : ''}>Always on</option>
            <option value="off" ${st.touchControls === 'off' ? 'selected' : ''}>Off</option>
          </select></div>
        <div class="controls">
          <span>A / D · ← →</span><span>Move</span>
          <span>Space</span><span>Jump (hold = higher)</span>
          <span>Shift</span><span>Sprint</span>
          <span>S · ↓</span><span>Slide / crouch</span>
          <span>J / K</span><span>Light / heavy attack</span>
          <span>U (hold)</span><span>Guard · tap in time = parry</span>
          <span>L</span><span>Dodge</span>
          <span>I</span><span>Shadow ability</span>
          <span>E</span><span>Interact</span>
          <span>W · ↑ (near rope)</span><span>Climb · jump + direction to leap off</span>
          <span>Esc</span><span>Pause</span>
        </div>
        <button class="btn" data-a="back">Back</button>
      </div>`);
    s.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((i) => {
      i.addEventListener('input', () => {
        (save.settings as any)[i.dataset.k!] = Number(i.value) / 100;
        save.saveSettings();
      });
      i.addEventListener('change', () => audio.sfx('ui'));
    });
    s.querySelectorAll<HTMLElement>('.toggle').forEach((t) => {
      t.addEventListener('click', () => {
        const k = t.dataset.t!;
        const v = !(save.settings as any)[k];
        (save.settings as any)[k] = v;
        t.classList.toggle('on', v);
        save.saveSettings();
        audio.sfx('ui');
      });
    });
    s.querySelectorAll<HTMLSelectElement>('select').forEach((sel) => {
      sel.addEventListener('change', () => {
        (save.settings as any)[sel.dataset.s!] = sel.value;
        save.saveSettings();
      });
    });
    s.querySelector('[data-a=back]')!.addEventListener('click', () => back());
    this.open('settings', back);
    this.settingsBack = back;
  }

  showCredits(back: Fn) {
    const s = this.make('credits', `
      <div class="panel modal">
        <div class="h2">Credits</div>
        <div class="text">
          ASHVA: Rise of the Forgotten<br><br>
          Game design, code, procedural art and synthesized music: created for this project.<br>
          Built with Phaser 3, TypeScript and Vite.<br><br>
          All characters, mythology, visuals and audio are original and generated in code.
          Inspired in spirit by silhouette parkour runners, folk-horror monsoon tales and shadow-martial-arts duels,
          but containing no assets, names or music from any of them.<br><br>
          <span style="color:var(--amber)">No external assets are used.</span>
        </div>
        <button class="btn" data-a="back">Back</button>
      </div>`);
    s.querySelector('[data-a=back]')!.addEventListener('click', () => back());
    this.open('credits', back);
  }

  // ------------------------------------------------------------------- pause
  showPause(h: { onResume: Fn; onRestart: Fn; onMenu: Fn }) {
    const s = this.make('pause', `
      <div class="panel modal">
        <div class="h2">Paused</div>
        <button class="btn" data-a="resume">Resume</button>
        <button class="btn" data-a="restart">Restart checkpoint</button>
        <button class="btn" data-a="settings">Settings</button>
        <button class="btn sub" data-a="fs">Fullscreen</button>
        <button class="btn danger" data-a="menu">Main menu</button>
      </div>`);
    const on = (a: string, fn: Fn) => s.querySelector(`[data-a=${a}]`)!.addEventListener('click', fn);
    on('resume', h.onResume);
    on('restart', h.onRestart);
    on('settings', () => this.showSettings(() => this.showPause(h)));
    on('fs', toggleFullscreen);
    on('menu', () => this.confirm('Return to the main menu? Progress since the last checkpoint is lost.', h.onMenu, () => this.showPause(h)));
    this.open('pause');
  }

  // --------------------------------------------------------------- game over
  showGameOver(h: { onRetry: Fn; onMenu: Fn }) {
    const s = this.make('gameover', `
      <div class="panel gameover">
        <h2>YOU FELL</h2>
        <div class="text" style="margin-bottom:10px">The shadow lets go of you, for now.</div>
        <button class="btn" data-a="retry">Retry checkpoint</button>
        <button class="btn danger" data-a="menu">Main menu</button>
      </div>`);
    s.querySelector('[data-a=retry]')!.addEventListener('click', h.onRetry);
    s.querySelector('[data-a=menu]')!.addEventListener('click', h.onMenu);
    this.open('gameover');
  }

  // -------------------------------------------------------- chapter complete
  showComplete(st: CompleteStats, h: { onContinue: Fn; onReplay: Fn; onMenu: Fn }) {
    const s = this.make('complete', `
      <div class="panel complete">
        <div class="sub">Chapter ${st.chapter} complete</div>
        <h2>${st.title}</h2>
        <div class="stats">
          <span>Time</span><span>${fmtTime(st.time)}</span>
          <span>Falls</span><span>${st.deaths}</span>
          <span>Relics</span><span>${st.relics} / ${st.relicTotal}</span>
          <span>Foes defeated</span><span>${st.kills}</span>
          <span>Parries</span><span>${st.parries}</span>
        </div>
        ${st.final ? '<div class="text" style="margin-bottom:10px">The Guardian is ash. The relic grows warm against your ribs.<br>Further chapters are not yet playable - the descent continues soon.</div>' : ''}
        <button class="btn" data-a="next">${st.hasNext ? 'Continue' : 'Main menu'}</button>
        <button class="btn" data-a="replay">Replay chapter</button>
        ${st.hasNext ? '<button class="btn danger" data-a="menu">Main menu</button>' : ''}
      </div>`);
    s.querySelector('[data-a=next]')!.addEventListener('click', st.hasNext ? h.onContinue : h.onMenu);
    s.querySelector('[data-a=replay]')!.addEventListener('click', h.onReplay);
    s.querySelector('[data-a=menu]')?.addEventListener('click', h.onMenu);
    this.open('complete');
  }

  // ----------------------------------------------------------------- confirm
  confirm(text: string, yes: Fn, no?: Fn) {
    const prev = this.current;
    const prevBack = this.backFn;
    const s = this.make('confirm', `
      <div class="panel modal">
        <div class="h2">Are you sure?</div>
        <div class="text">${text}</div>
        <button class="btn danger" data-a="yes">Yes</button>
        <button class="btn" data-a="no">Cancel</button>
      </div>`);
    s.querySelector('[data-a=yes]')!.addEventListener('click', () => {
      this.hideAll();
      yes();
    });
    s.querySelector('[data-a=no]')!.addEventListener('click', () => {
      if (no) no();
      else if (prev) {
        for (const k in this.screens) this.screens[k].classList.toggle('on', k === prev);
        this.current = prev;
        this.backFn = prevBack;
        this.screens[prev].querySelector<HTMLElement>('.btn:not([disabled])')?.focus();
      }
    });
    for (const k in this.screens) this.screens[k].classList.toggle('on', k === 'confirm');
    this.current = 'confirm';
    this.backFn = null;
    s.querySelector<HTMLElement>('[data-a=no]')!.focus();
  }
}

export const menus = new MenusImpl();
