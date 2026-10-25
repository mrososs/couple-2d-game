import { describe, expect, test } from 'vitest';
import { Basket, bestUnitCost, changeChoices, formatEgp, unitCost } from './budget.ts';
import { L2_PRODUCTS, L2_RULES } from './levels/content.ts';

const basket = (...ids: string[]) => {
  const b = new Basket(L2_PRODUCTS, L2_RULES);
  for (const id of ids) b.add(id);
  return b;
};

describe('Basket', () => {
  test('the spending limit keeps a tenth of the budget in reserve', () => {
    expect(basket().limit).toBe(3150);
  });

  test('the cot route with the best-value nappies is valid', () => {
    const e = basket('diapersL', 'clothes', 'bath', 'firstAid', 'crib').evaluate();
    expect(e).toMatchObject({ spent: 2780, remaining: 720, valid: true, bestValueDiapers: true, missing: [] });
  });

  test('the cheaper bassinet route is valid too, with room for one extra', () => {
    expect(basket('diapersL', 'clothes', 'bath', 'firstAid', 'bassinet', 'mobile').evaluate().valid).toBe(true);
  });

  test('two smaller packs can cover the nappies, at a worse price per piece', () => {
    const e = basket('diapersM', 'diapersS', 'clothes', 'bath', 'firstAid', 'crib').evaluate();
    expect(e.valid).toBe(true);
    expect(e.diapers).toBe(64);
    expect(e.bestValueDiapers).toBe(false);
    expect(e.diaperUnitCost).toBeCloseTo(820 / 64);
  });

  test('two medium packs push the cot route just past the reserve', () => {
    const e = basket('diapersM', 'diapersM2', 'clothes', 'bath', 'firstAid', 'crib').evaluate();
    expect(e.spent).toBe(3160);
    expect(e.withinLimit).toBe(false);
    expect(e.valid).toBe(false);
  });

  test('extras eat into the reserve', () => {
    const e = basket('diapersL', 'clothes', 'bath', 'firstAid', 'crib', 'teddy', 'warmer').evaluate();
    expect(e.extras).toBe(2);
    expect(e.withinLimit).toBe(false);
  });

  test('missing needs and too few nappies are reported', () => {
    const e = basket('diapersS', 'clothes').evaluate();
    expect(e.missing).toEqual(['sleep', 'hygiene', 'health']);
    expect(e.enoughDiapers).toBe(false);
  });

  test('the last product added comes out first', () => {
    const b = basket('clothes', 'bath');
    expect(b.takeLast()?.id).toBe('bath');
    expect(b.total()).toBe(450);
  });

  test('unit costs: the 60-pack is the best value per nappy', () => {
    expect(bestUnitCost(L2_PRODUCTS)).toBe(11);
    expect(unitCost(L2_PRODUCTS.find((p) => p.id === 'diapersS')!)).toBe(12.5);
    expect(unitCost(L2_PRODUCTS.find((p) => p.id === 'clothes')!)).toBeNull();
  });
});

describe('changeChoices', () => {
  test('always includes the right change, with two plausible slips', () => {
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const { correct, choices } = changeChoices(3500, 2780, seed);
      expect(correct).toBe(720);
      expect(choices).toContain(720);
      expect(new Set(choices).size).toBe(3);
      for (const c of choices) expect(c).toBeGreaterThanOrEqual(0);
    }
  });

  test('the right answer does not always sit in the same place', () => {
    const positions = new Set([0, 1, 2].map((seed) => changeChoices(3500, 2780, seed).choices.indexOf(720)));
    expect(positions.size).toBeGreaterThan(1);
  });
});

test('prices are written as Egyptian pounds with thousands separators', () => {
  expect(formatEgp(2780)).toBe('2,780 ج');
});
