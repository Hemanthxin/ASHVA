/**
 * SHADOW DEBT: every use of a powerful shadow ability borrows against the force beneath the earth.
 * The debt is visible (HUD meter, world tint, shadow particles) and has functional consequences.
 * It is paid down at rest lamps, by collecting embers, by parrying, and by defeating wraiths.
 */
export type DebtStage = 0 | 1 | 2 | 3;

export const DEBT_STAGES = [
  { id: 0, name: 'Calm', from: 0 },
  { id: 1, name: 'Stirring', from: 25 },
  { id: 2, name: 'Hungry', from: 50 },
  { id: 3, name: 'Consumed', from: 75 },
] as const;

export interface ShadowAbility {
  id: string;
  name: string;
  cost: number; // debt added per use
  cooldown: number; // seconds
  /** Damage multiplier by stage (stronger but riskier). */
  power: [number, number, number, number];
}

export const SHADOW_DASH: ShadowAbility = {
  id: 'shadowDash',
  name: 'Shadow Dash',
  cost: 16,
  cooldown: 0.9,
  power: [1, 1.1, 1.3, 1.6],
};

/** Debt needed before hidden "shadow bridges" become solid. */
export const REVEAL_THRESHOLD = 40;
export const MAX_DEBT = 100;

export class ShadowDebt {
  value = 0;
  private listeners: Array<(v: number, stage: DebtStage) => void> = [];
  private lastStage: DebtStage = 0;

  set(v: number) {
    this.value = Math.max(0, Math.min(MAX_DEBT, v));
    this.emit();
  }
  add(n: number) {
    this.set(this.value + n);
  }
  reduce(n: number) {
    this.set(this.value - n);
  }

  get stage(): DebtStage {
    const v = this.value;
    return v >= 75 ? 3 : v >= 50 ? 2 : v >= 25 ? 1 : 0;
  }
  /** Enemies hit and recover faster as the debt grows. */
  get aggression(): number {
    return [1, 1, 1.2, 1.4][this.stage];
  }
  get revealsHidden(): boolean {
    return this.value >= REVEAL_THRESHOLD;
  }
  /** At 100% the shadow refuses to answer until some debt is paid. */
  canUse(a: ShadowAbility): boolean {
    return this.value + a.cost <= MAX_DEBT + 8 && this.value < MAX_DEBT;
  }
  powerOf(a: ShadowAbility): number {
    return a.power[this.stage];
  }

  use(a: ShadowAbility) {
    this.add(a.cost);
  }

  onChange(fn: (v: number, stage: DebtStage) => void) {
    this.listeners.push(fn);
  }
  clearListeners() {
    this.listeners = [];
  }
  private emit() {
    const s = this.stage;
    this.listeners.forEach((l) => l(this.value, s));
    this.lastStage = s;
  }
  get previousStage() {
    return this.lastStage;
  }
}
