import { input, Action } from '../systems/InputSystem';
import { save } from '../systems/SaveSystem';
import { hud } from './HUD';

/**
 * On-screen controls for phones/tablets: a floating analog stick on the left half (push fully to
 * sprint, pull down to crouch/slide, flick up to jump) and action buttons on the right.
 */
class TouchImpl {
  root!: HTMLElement;
  private stick!: HTMLElement;
  private nub!: HTMLElement;
  private useBtn!: HTMLElement;
  private stickId = -1;
  private ox = 0;
  private oy = 0;
  private radius = 56;
  private flicked = false;
  private active = false;

  isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
  }

  mount(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'touch';
    root.innerHTML = `
      <div class="zone"></div>
      <div class="stick"><i></i></div>
      <button class="tbtn big" data-a="jump" style="right:calc(26px + var(--safe-r));bottom:calc(22px + var(--safe-b))">Jump</button>
      <button class="tbtn med" data-a="light" style="right:calc(128px + var(--safe-r));bottom:calc(30px + var(--safe-b))">Strike</button>
      <button class="tbtn med" data-a="heavy" style="right:calc(112px + var(--safe-r));bottom:calc(108px + var(--safe-b))">Heavy</button>
      <button class="tbtn sm" data-a="dodge" style="right:calc(28px + var(--safe-r));bottom:calc(122px + var(--safe-b))">Dodge</button>
      <button class="tbtn sm shadow" data-a="shadow" style="right:calc(200px + var(--safe-r));bottom:calc(104px + var(--safe-b))">Shadow</button>
      <button class="tbtn sm" data-a="block" style="right:calc(206px + var(--safe-r));bottom:calc(22px + var(--safe-b))">Guard</button>
      <button class="tbtn med use" data-a="interact" style="right:calc(120px + var(--safe-r));bottom:calc(186px + var(--safe-b))">Use</button>
    `;
    parent.appendChild(root);
    this.root = root;
    this.stick = root.querySelector('.stick')!;
    this.nub = root.querySelector('.stick i')!;
    this.useBtn = root.querySelector('.use')!;

    root.querySelectorAll<HTMLElement>('.tbtn').forEach((b) => {
      const a = b.dataset.a as Action;
      const press = (e: PointerEvent) => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        b.classList.add('down');
        input.setVirtual(a, true);
        input.fireAny();
      };
      const release = (e: PointerEvent) => {
        e.preventDefault();
        b.classList.remove('down');
        input.setVirtual(a, false);
      };
      b.addEventListener('pointerdown', press);
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('lostpointercapture', () => {
        b.classList.remove('down');
        input.setVirtual(a, false);
      });
    });

    const zone = root.querySelector<HTMLElement>('.zone')!;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== -1) return;
      e.preventDefault();
      try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      this.stickId = e.pointerId;
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.flicked = false;
      const r = parent.getBoundingClientRect();
      this.stick.style.left = `${e.clientX - r.left}px`;
      this.stick.style.top = `${e.clientY - r.top}px`;
      this.stick.classList.add('on');
      this.nub.style.transform = 'translate(0,0)';
      input.lastDevice = 'touch';
      input.fireAny();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      let dx = e.clientX - this.ox;
      let dy = e.clientY - this.oy;
      const len = Math.hypot(dx, dy);
      // Drag the stick origin along so the thumb never runs out of room.
      if (len > this.radius * 1.5) {
        const k = (len - this.radius * 1.5) / len;
        this.ox += dx * k;
        this.oy += dy * k;
        const r = parent.getBoundingClientRect();
        this.stick.style.left = `${this.ox - r.left}px`;
        this.stick.style.top = `${this.oy - r.top}px`;
        dx = e.clientX - this.ox;
        dy = e.clientY - this.oy;
      }
      const c = Math.min(1, Math.hypot(dx, dy) / this.radius);
      const ang = Math.atan2(dy, dx);
      this.nub.style.transform = `translate(${Math.cos(ang) * c * this.radius * 0.8}px, ${Math.sin(ang) * c * this.radius * 0.8}px)`;
      const nx = dx / this.radius;
      const ny = dy / this.radius;
      input.stickX = Math.abs(nx) < 0.18 ? 0 : Math.max(-1, Math.min(1, nx));
      input.setVirtual('down', ny > 0.55);
      if (ny < -0.8 && !this.flicked) {
        this.flicked = true;
        input.setVirtual('jump', true);
        window.setTimeout(() => input.setVirtual('jump', false), 90);
      } else if (ny > -0.4) this.flicked = false;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      input.stickX = 0;
      input.setVirtual('down', false);
      this.stick.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', (e) => end(e as PointerEvent));

    // Pause button lives in the HUD.
    hud.pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.setVirtual('pause', true);
      window.setTimeout(() => input.setVirtual('pause', false), 60);
    });

    window.addEventListener('touchstart', () => this.refresh(), { passive: true, once: true });
    save.onSettings(() => this.refresh());
    this.refresh();
  }

  /** Show or hide the overlay according to settings + detection. */
  refresh(force?: boolean) {
    const mode = save.settings.touchControls;
    const on = mode === 'on' || (mode === 'auto' && this.isTouchDevice());
    document.body.classList.toggle('is-touch', on);
    this.root.classList.toggle('active', on && (force ?? this.active));
  }

  /** Enabled only while a level is being played. */
  setActive(v: boolean) {
    this.active = v;
    this.refresh(v);
    if (!v) {
      input.releaseAll();
      this.stick.classList.remove('on');
      this.stickId = -1;
    }
  }

  /** Combat buttons only appear once the matching ability has been found. */
  setAbilities(a: { blade: boolean; shadowDash: boolean }) {
    this.root.querySelectorAll<HTMLElement>('[data-a=light],[data-a=heavy],[data-a=block]').forEach((b) => b.classList.toggle('hidden', !a.blade));
    this.root.querySelector<HTMLElement>('[data-a=shadow]')?.classList.toggle('hidden', !a.shadowDash);
  }

  setUse(on: boolean) {
    this.useBtn.classList.toggle('on', on);
  }
}

export const touch = new TouchImpl();
