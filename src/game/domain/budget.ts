/**
 * Level 2's puzzle: preparing for the baby within an illustrative budget.
 *
 * Prices are invented for the game, in Egyptian pounds, so the arithmetic is the point rather
 * than the market: the level says so on screen. A basket is valid when every essential need is
 * covered, there are enough nappies for the first weeks, and an emergency reserve is kept - which
 * leaves several valid baskets (a cot or a smaller bassinet, one big pack of nappies or two
 * smaller ones). The best value per nappy and a correct change count earn the extra stars.
 */

export type Need = 'diapers' | 'clothes' | 'sleep' | 'hygiene' | 'health';
export type Category = Need | 'extra';

export const NEEDS: readonly Need[] = ['diapers', 'clothes', 'sleep', 'hygiene', 'health'];

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly art: string;
  readonly price: number;
  readonly category: Category;
  /** Pieces in the pack, for unit-cost comparison (nappies). */
  readonly units?: number;
  /** Needs two people to carry. */
  readonly heavy?: boolean;
  /** A big spend both partners must agree to at the trolley. */
  readonly joint?: boolean;
  /** Kept in the storeroom, behind the shutter. */
  readonly storeroom?: boolean;
  /** Shown when it goes into the trolley. */
  readonly note?: string;
}

export interface BudgetRules {
  readonly budget: number;
  /** Fraction of the budget to keep aside for emergencies. */
  readonly reserveRate: number;
  readonly minDiapers: number;
}

export interface BasketEvaluation {
  readonly spent: number;
  readonly remaining: number;
  readonly limit: number;
  readonly covered: readonly Need[];
  readonly missing: readonly Need[];
  readonly diapers: number;
  readonly enoughDiapers: boolean;
  readonly withinLimit: boolean;
  readonly extras: number;
  /** Average EGP per nappy across the packs in the basket, or null with none. */
  readonly diaperUnitCost: number | null;
  readonly bestValueDiapers: boolean;
  readonly valid: boolean;
}

export class Basket {
  private readonly items: string[] = [];

  constructor(
    readonly catalog: readonly Product[],
    readonly rules: BudgetRules,
  ) {}

  product(id: string): Product {
    const product = this.catalog.find((p) => p.id === id);
    if (!product) throw new Error(`Unknown product '${id}'`);
    return product;
  }

  get contents(): readonly Product[] {
    return this.items.map((id) => this.product(id));
  }

  add(id: string): void {
    this.product(id);
    this.items.push(id);
  }

  /** Takes out the most recently added product, as from the top of the trolley. */
  takeLast(): Product | undefined {
    const id = this.items.pop();
    return id ? this.product(id) : undefined;
  }

  remove(id: string): boolean {
    const i = this.items.lastIndexOf(id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }

  get limit(): number {
    return Math.round(this.rules.budget * (1 - this.rules.reserveRate));
  }

  total(): number {
    return this.contents.reduce((sum, p) => sum + p.price, 0);
  }

  /** What adding a product would leave below the spending limit (negative when over). */
  headroomAfter(id: string): number {
    return this.limit - this.total() - this.product(id).price;
  }

  evaluate(): BasketEvaluation {
    const spent = this.total();
    const covered = NEEDS.filter((need) => this.contents.some((p) => p.category === need));
    const missing = NEEDS.filter((need) => !covered.includes(need));
    const diaperPacks = this.contents.filter((p) => p.category === 'diapers');
    const diapers = diaperPacks.reduce((sum, p) => sum + (p.units ?? 0), 0);
    const diaperSpend = diaperPacks.reduce((sum, p) => sum + p.price, 0);
    const diaperUnitCost = diapers > 0 ? diaperSpend / diapers : null;
    const enoughDiapers = diapers >= this.rules.minDiapers;
    const withinLimit = spent <= this.limit;
    return {
      spent,
      remaining: this.rules.budget - spent,
      limit: this.limit,
      covered,
      missing,
      diapers,
      enoughDiapers,
      withinLimit,
      extras: this.contents.filter((p) => p.category === 'extra').length,
      diaperUnitCost,
      bestValueDiapers: diaperUnitCost !== null && diaperUnitCost <= bestUnitCost(this.catalog) + 1e-9,
      valid: missing.length === 0 && enoughDiapers && withinLimit,
    };
  }
}

/** The lowest EGP per piece any nappy pack in the catalog offers. */
export function bestUnitCost(catalog: readonly Product[]): number {
  const costs = catalog.filter((p) => p.category === 'diapers' && p.units).map((p) => p.price / p.units!);
  return Math.min(...costs);
}

export function unitCost(product: Product): number | null {
  return product.units ? product.price / product.units : null;
}

/**
 * The change the cashier asks about, with two near misses: a mistake of a hundred, and one of
 * fifty, either side - the slips people actually make when subtracting in their head.
 */
export function changeChoices(paid: number, total: number, seed = 1): { correct: number; choices: number[] } {
  const correct = paid - total;
  const deltas = seed % 2 ? [100, -50] : [-100, 50];
  const wrong = deltas.map((d) => correct + d).filter((v) => v >= 0 && v !== correct);
  while (wrong.length < 2) wrong.push(correct + 10 * (wrong.length + 2));
  const choices = [correct, ...wrong.slice(0, 2)];
  // A fixed rotation so the right answer is not always in the same place.
  const shift = seed % 3;
  return { correct, choices: [...choices.slice(shift), ...choices.slice(0, shift)] };
}

export function formatEgp(value: number): string {
  const digits = Math.round(value).toLocaleString('en-US');
  return `${digits} ج`;
}
