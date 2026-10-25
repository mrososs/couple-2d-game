/**
 * Level 1's puzzle: sharing the responsibilities of a first pregnancy on a planning board.
 *
 * The board does not hold one right answer. It checks the approach: decisions that belong to both
 * of them are made together, heavy lifting does not land on the pregnant partner alone, and the
 * load is shared within a range rather than at an exact split - during pregnancy "fair" is not
 * always 50/50, and neither is a plan where one partner carries almost everything.
 */

export type Lane = 'wife' | 'shared' | 'husband';
export const LANES: readonly Lane[] = ['wife', 'shared', 'husband'];

export type TaskTag = 'decision' | 'heavy';

export interface TaskCard {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  /** Rough weekly effort, 1..4. Shared cards count half for each partner. */
  readonly load: number;
  readonly tags: readonly TaskTag[];
}

export type PlanIssue =
  | { readonly kind: 'decisionAlone'; readonly cardId: string }
  | { readonly kind: 'heavyOnPregnant'; readonly cardId: string }
  | { readonly kind: 'imbalanced'; readonly heavier: 'wife' | 'husband' }
  | { readonly kind: 'unplaced'; readonly count: number };

export interface PlanEvaluation {
  readonly placed: number;
  readonly total: number;
  readonly wifeLoad: number;
  readonly husbandLoad: number;
  /** wife / (wife + husband), 0..1. */
  readonly wifeShare: number;
  readonly balanced: boolean;
  readonly issues: readonly PlanIssue[];
  readonly ok: boolean;
}

/** The range of the wife's share of the load that counts as balanced. */
export const BALANCE_RANGE = { min: 0.3, max: 0.55 } as const;

export class PlanningBoard {
  private readonly lanes = new Map<string, Lane>();
  private readonly order: string[] = [];

  constructor(readonly cards: readonly TaskCard[]) {}

  card(id: string): TaskCard {
    const card = this.cards.find((c) => c.id === id);
    if (!card) throw new Error(`Unknown card '${id}'`);
    return card;
  }

  laneOf(id: string): Lane | undefined {
    return this.lanes.get(id);
  }

  cardsIn(lane: Lane): TaskCard[] {
    return this.order.filter((id) => this.lanes.get(id) === lane).map((id) => this.card(id));
  }

  get placedCount(): number {
    return this.lanes.size;
  }

  /** Places a card and returns the gentle notes worth showing at once (empty when none). */
  place(id: string, lane: Lane): PlanIssue[] {
    const card = this.card(id);
    this.remove(id);
    this.lanes.set(id, lane);
    this.order.push(id);
    return issuesFor(card, lane);
  }

  remove(id: string): void {
    if (!this.lanes.delete(id)) return;
    this.order.splice(this.order.indexOf(id), 1);
  }

  /** The most recently placed card in a lane, for taking it back off the board. */
  lastIn(lane: Lane): TaskCard | undefined {
    const id = [...this.order].reverse().find((cardId) => this.lanes.get(cardId) === lane);
    return id ? this.card(id) : undefined;
  }

  loads(): { wife: number; husband: number } {
    let wife = 0;
    let husband = 0;
    for (const [id, lane] of this.lanes) {
      const { load } = this.card(id);
      if (lane === 'wife') wife += load;
      else if (lane === 'husband') husband += load;
      else {
        wife += load / 2;
        husband += load / 2;
      }
    }
    return { wife, husband };
  }

  evaluate(): PlanEvaluation {
    const { wife, husband } = this.loads();
    const total = wife + husband;
    const wifeShare = total === 0 ? 0.5 : wife / total;
    const balanced = wifeShare >= BALANCE_RANGE.min && wifeShare <= BALANCE_RANGE.max;
    const issues: PlanIssue[] = [];
    const unplaced = this.cards.length - this.lanes.size;
    if (unplaced > 0) issues.push({ kind: 'unplaced', count: unplaced });
    for (const [id, lane] of this.lanes) issues.push(...issuesFor(this.card(id), lane));
    if (unplaced === 0 && !balanced) issues.push({ kind: 'imbalanced', heavier: wifeShare > BALANCE_RANGE.max ? 'wife' : 'husband' });
    return {
      placed: this.lanes.size,
      total: this.cards.length,
      wifeLoad: wife,
      husbandLoad: husband,
      wifeShare,
      balanced,
      issues,
      ok: issues.length === 0,
    };
  }
}

function issuesFor(card: TaskCard, lane: Lane): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (card.tags.includes('decision') && lane !== 'shared') issues.push({ kind: 'decisionAlone', cardId: card.id });
  if (card.tags.includes('heavy') && lane === 'wife') issues.push({ kind: 'heavyOnPregnant', cardId: card.id });
  return issues;
}

// ---------------------------------------------------------------------------------------------
// The planning conflict: finding a day for the check-up that works for everyone.

export const DAYS = ['السبت', 'الحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة'] as const;

export type ScheduleVerdict = 'agreed' | 'notSameDay' | 'doctorUnavailable' | 'wifeBusy' | 'husbandBusy' | 'bothBusy';

export interface ScheduleSpec {
  readonly doctorDays: readonly number[];
  readonly wifeFree: readonly number[];
  readonly husbandFree: readonly number[];
}

/**
 * Each partner pins one day on the shared calendar. Only the doctor's days are public; each
 * partner's own free days are visible to that partner alone, so they have to talk to agree.
 */
export class SchedulePuzzle {
  private pins: { wife: number | null; husband: number | null } = { wife: null, husband: null };
  private attempts = 0;

  constructor(readonly spec: ScheduleSpec) {
    if (this.solutions().length === 0) throw new Error('A schedule puzzle needs at least one solution');
  }

  pin(who: 'wife' | 'husband', day: number): void {
    if (day < 0 || day >= DAYS.length) throw new Error(`No day ${day}`);
    this.pins = { ...this.pins, [who]: day };
  }

  pinOf(who: 'wife' | 'husband'): number | null {
    return this.pins[who];
  }

  get wrongAttempts(): number {
    return this.attempts;
  }

  solutions(): number[] {
    const { doctorDays, wifeFree, husbandFree } = this.spec;
    return doctorDays.filter((d) => wifeFree.includes(d) && husbandFree.includes(d));
  }

  /** Checked once both pins are down. A wrong answer counts, but never locks anyone out. */
  check(): ScheduleVerdict | null {
    const { wife, husband } = this.pins;
    if (wife === null || husband === null) return null;
    let verdict: ScheduleVerdict;
    if (wife !== husband) verdict = 'notSameDay';
    else if (!this.spec.doctorDays.includes(wife)) verdict = 'doctorUnavailable';
    else {
      const wifeOk = this.spec.wifeFree.includes(wife);
      const husbandOk = this.spec.husbandFree.includes(wife);
      verdict = wifeOk && husbandOk ? 'agreed' : !wifeOk && !husbandOk ? 'bothBusy' : !wifeOk ? 'wifeBusy' : 'husbandBusy';
    }
    if (verdict !== 'agreed' && verdict !== 'notSameDay') this.attempts++;
    return verdict;
  }
}
