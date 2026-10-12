import { input } from '../systems/InputSystem';

const el = (cls: string, html = '', tag = 'div') => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** Replace [action] tokens with the label for the active input device. */
export function fmt(text: string): string {
  return text.replace(/\[(\w+)\]/g, (_m, a) => {
    try {
      return input.label(a as never);
    } catch {
      return a;
    }
  });
}

const STAGE_NAMES = ['Calm', 'Stirring', 'Hungry', 'Consumed'];

/** In-game DOM HUD. Updates only when values change. */
class HudImpl {
  root!: HTMLElement;
  private hpFill!: HTMLElement;
  private hpGhost!: HTMLElement;
  private debtFill!: HTMLElement;
  private debtStage!: HTMLElement;
  private debtPct!: HTMLElement;
  private relics!: HTMLElement;
  private titleCard!: HTMLElement;
  private toastEl!: HTMLElement;
  private promptEl!: HTMLElement;
  private bossEl!: HTMLElement;
  private bossName!: HTMLElement;
  private bossFill!: HTMLElement;
  private bars!: HTMLElement;
  private subtitle!: HTMLElement;
  private fadeEl!: HTMLElement;
  pauseBtn!: HTMLElement;
  private toastT = 0;
  private titleT = 0;
  private lastPrompt = '';
  private lastDebtStage = -1;
  private lastHp = -1;
  private lastDebt = -1;
  private subT = 0;

  mount(parent: HTMLElement) {
    const root = el('hud');
    this.root = root;
    root.innerHTML = `
      <div class="vitals">
        <div class="bar hp"><b></b><i></i></div>
        <div class="bar debt"><i></i><span class="tick" style="left:25%"></span><span class="tick" style="left:50%"></span><span class="tick" style="left:75%"></span></div>
        <div class="debt-label"><span>Shadow Debt</span><span class="stage">Calm</span></div>
      </div>
      <div class="relics">0 / 0</div>
      <div class="title-card"><h2></h2><p></p></div>
      <div class="toast"></div>
      <div class="prompt"></div>
      <div class="boss"><div class="name"></div><div class="bar"><i></i><span class="tick" style="left:66%"></span><span class="tick" style="left:33%"></span></div></div>
      <div class="bars"></div>
      <div class="subtitle"></div>
    `;
    parent.appendChild(root);
    this.hpFill = root.querySelector('.bar.hp i')!;
    this.hpGhost = root.querySelector('.bar.hp b')!;
    this.debtFill = root.querySelector('.bar.debt i')!;
    this.debtStage = root.querySelector('.debt-label .stage')!;
    this.debtPct = this.debtStage;
    this.relics = root.querySelector('.relics')!;
    this.titleCard = root.querySelector('.title-card')!;
    this.toastEl = root.querySelector('.toast')!;
    this.promptEl = root.querySelector('.prompt')!;
    this.bossEl = root.querySelector('.boss')!;
    this.bossName = root.querySelector('.boss .name')!;
    this.bossFill = root.querySelector('.boss .bar i')!;
    this.bars = root.querySelector('.bars')!;
    this.subtitle = root.querySelector('.subtitle')!;
    this.fadeEl = el('fade');
    this.fadeEl.classList.add('on');
    parent.appendChild(this.fadeEl);
    this.pauseBtn = el('pause-btn', '<span>II</span>', 'button');
    parent.appendChild(this.pauseBtn);
    this.pauseBtn.style.display = 'none';
  }

  show() {
    this.root.classList.add('on');
    this.pauseBtn.style.display = '';
  }
  hide() {
    this.root.classList.remove('on');
    this.pauseBtn.style.display = 'none';
    this.hideBoss();
    this.bars.classList.remove('on');
    this.subtitle.classList.remove('on');
    this.prompt(null);
    this.toastEl.classList.remove('on');
    this.titleCard.classList.remove('on');
  }

  setHealth(hp: number, max: number) {
    const k = Math.max(0, Math.min(1, hp / max));
    if (k === this.lastHp) return;
    this.hpFill.style.transform = `scaleX(${k})`;
    this.hpGhost.style.transform = `scaleX(${k})`;
    if (this.lastHp < 0) this.hpGhost.style.transition = 'none';
    else this.hpGhost.style.transition = '';
    this.lastHp = k;
  }

  setDebt(v: number, stage: number) {
    if (Math.round(v) === this.lastDebt && stage === this.lastDebtStage) return;
    this.lastDebt = Math.round(v);
    this.debtFill.style.transform = `scaleX(${Math.max(0.001, v / 100)})`;
    if (stage !== this.lastDebtStage) {
      this.lastDebtStage = stage;
      this.debtStage.textContent = STAGE_NAMES[stage];
    }
    this.debtPct.textContent = `${STAGE_NAMES[stage]} · ${Math.round(v)}%`;
  }

  setRelics(got: number, total: number) {
    this.relics.textContent = `${got} / ${total}`;
  }

  title(title: string, sub?: string, seconds = 3.6) {
    this.titleCard.querySelector('h2')!.textContent = title;
    this.titleCard.querySelector('p')!.textContent = sub ?? '';
    this.titleCard.classList.add('on');
    this.titleT = seconds;
  }

  toast(text: string, seconds = 3.5) {
    this.toastEl.innerHTML = fmt(text);
    this.toastEl.classList.add('on');
    this.toastT = seconds;
  }

  prompt(text: string | null, key?: string) {
    const v = text ? `${key ?? ''}|${text}` : '';
    if (v === this.lastPrompt) return;
    this.lastPrompt = v;
    if (!text) {
      this.promptEl.classList.remove('on');
      return;
    }
    this.promptEl.innerHTML = `<kbd>${key ?? input.label('interact')}</kbd>${text}`;
    this.promptEl.classList.add('on');
  }

  setBoss(name: string, hp: number, max: number) {
    this.bossName.textContent = name;
    this.bossFill.style.transform = `scaleX(${Math.max(0, hp / max)})`;
    this.bossEl.classList.add('on');
  }
  hideBoss() {
    this.bossEl.classList.remove('on');
  }

  letterbox(on: boolean) {
    this.bars.classList.toggle('on', on);
  }
  subtitleText(text: string | null) {
    if (text) {
      this.subtitle.innerHTML = fmt(text);
      this.subtitle.classList.add('on');
    } else this.subtitle.classList.remove('on');
  }

  fade(toBlack: boolean, ms = 600): Promise<void> {
    this.fadeEl.style.transition = `opacity ${ms}ms`;
    // force style flush so the transition runs
    void this.fadeEl.offsetWidth;
    this.fadeEl.classList.toggle('on', toBlack);
    return new Promise((res) => window.setTimeout(res, ms));
  }
  /** Instantly set the fade state without animation. */
  fadeNow(toBlack: boolean) {
    this.fadeEl.style.transition = 'none';
    this.fadeEl.classList.toggle('on', toBlack);
    void this.fadeEl.offsetWidth;
  }

  /** Real-time timers for transient elements (independent of game slow-motion). */
  tick(dt: number) {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.classList.remove('on');
    }
    if (this.titleT > 0) {
      this.titleT -= dt;
      if (this.titleT <= 0) this.titleCard.classList.remove('on');
    }
    void this.subT;
  }
}

export const hud = new HudImpl();
