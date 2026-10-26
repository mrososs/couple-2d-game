import { describe, expect, test } from 'vitest';
import { L1_CARDS, L1_SCHEDULE } from './levels/content.ts';
import { PlanningBoard, SchedulePuzzle, type Lane } from './planning.ts';

const BALANCED: Record<string, Lane> = {
  prenatal: 'shared',
  hospital: 'shared',
  budget: 'shared',
  nights: 'shared',
  boxes: 'husband',
  groceries: 'husband',
  cleaning: 'husband',
  cooking: 'wife',
  family: 'wife',
};

function boardWith(plan: Record<string, Lane>): PlanningBoard {
  const board = new PlanningBoard(L1_CARDS);
  for (const [id, lane] of Object.entries(plan)) board.place(id, lane);
  return board;
}

describe('PlanningBoard', () => {
  test('a balanced plan with shared decisions passes', () => {
    const result = boardWith(BALANCED).evaluate();
    expect(result.issues).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.balanced).toBe(true);
  });

  test('more than one allocation is valid: there is no single right answer', () => {
    const alternative = { ...BALANCED, cleaning: 'shared' as Lane, cooking: 'shared' as Lane, family: 'husband' as Lane, groceries: 'wife' as Lane };
    expect(boardWith(alternative).evaluate().ok).toBe(true);
  });

  test('shared cards count half for each partner', () => {
    const board = new PlanningBoard(L1_CARDS);
    board.place('prenatal', 'shared');
    expect(board.loads()).toEqual({ wife: 1, husband: 1 });
  });

  test('a decision placed in one lane is flagged at once and on review', () => {
    const board = new PlanningBoard(L1_CARDS);
    expect(board.place('hospital', 'husband')).toEqual([{ kind: 'decisionAlone', cardId: 'hospital' }]);
    const plan = boardWith({ ...BALANCED, hospital: 'husband' });
    expect(plan.evaluate().issues).toContainEqual({ kind: 'decisionAlone', cardId: 'hospital' });
  });

  test('heavy lifting on the pregnant partner alone is flagged', () => {
    const result = boardWith({ ...BALANCED, boxes: 'wife' }).evaluate();
    expect(result.issues).toContainEqual({ kind: 'heavyOnPregnant', cardId: 'boxes' });
    expect(boardWith({ ...BALANCED, boxes: 'shared' }).evaluate().issues).not.toContainEqual(expect.objectContaining({ kind: 'heavyOnPregnant' }));
  });

  test('a lopsided plan is a note to agree on, not a failure, and the rule is the same for both', () => {
    const allOnHer = boardWith({ ...BALANCED, boxes: 'husband', groceries: 'wife', cleaning: 'wife', cooking: 'wife', family: 'wife' }).evaluate();
    expect(allOnHer.ok).toBe(true);
    expect(allOnHer.balanced).toBe(false);
    expect(allOnHer.notes).toEqual([{ kind: 'lopsided', heavier: 'wife', share: expect.closeTo(17.5 / 24, 5) }]);
    const allOnHim = boardWith({ ...BALANCED, cooking: 'husband', family: 'husband' }).evaluate();
    expect(allOnHim.ok).toBe(true);
    expect(allOnHim.notes).toEqual([{ kind: 'lopsided', heavier: 'husband', share: expect.closeTo(19.5 / 24, 5) }]);
  });

  test('the same split mirrored gets the same treatment: nothing depends on which partner it is', () => {
    const board = new PlanningBoard([
      { id: 'a', title: 'a', icon: '', load: 3, tags: [] },
      { id: 'b', title: 'b', icon: '', load: 1, tags: [] },
    ]);
    board.place('a', 'wife');
    board.place('b', 'husband');
    const one = board.evaluate();
    board.place('a', 'husband');
    board.place('b', 'wife');
    const other = board.evaluate();
    expect(one.balanced).toBe(other.balanced);
    expect(one.notes[0]?.share).toBe(other.notes[0]?.share);
    expect([one.notes[0]?.heavier, other.notes[0]?.heavier]).toEqual(['wife', 'husband']);
  });

  test("the plan's key changes when a card moves, so an agreement covers that plan only", () => {
    const board = boardWith(BALANCED);
    const before = board.key();
    board.place('cooking', 'husband');
    expect(board.key()).not.toBe(before);
    board.place('cooking', 'wife');
    expect(board.key()).toBe(before);
  });

  test('cards can be taken back off the board, last one first', () => {
    const board = new PlanningBoard(L1_CARDS);
    board.place('cooking', 'wife');
    board.place('family', 'wife');
    expect(board.lastIn('wife')?.id).toBe('family');
    board.remove('family');
    expect(board.cardsIn('wife').map((c) => c.id)).toEqual(['cooking']);
    expect(board.evaluate().issues).toContainEqual({ kind: 'unplaced', count: L1_CARDS.length - 1 });
  });

  test('moving a card to another lane replaces its old place', () => {
    const board = new PlanningBoard(L1_CARDS);
    board.place('cooking', 'wife');
    board.place('cooking', 'husband');
    expect(board.placedCount).toBe(1);
    expect(board.laneOf('cooking')).toBe('husband');
  });
});

describe('SchedulePuzzle', () => {
  test('the level 1 week has exactly one day that suits the doctor and both partners', () => {
    expect(new SchedulePuzzle(L1_SCHEDULE).solutions()).toEqual([3]);
  });

  test('both pins on the right day agree', () => {
    const puzzle = new SchedulePuzzle(L1_SCHEDULE);
    puzzle.pin('wife', 3);
    expect(puzzle.check()).toBeNull();
    puzzle.pin('husband', 3);
    expect(puzzle.check()).toBe('agreed');
    expect(puzzle.wrongAttempts).toBe(0);
  });

  test('wrong days explain why, and count as attempts', () => {
    const puzzle = new SchedulePuzzle(L1_SCHEDULE);
    puzzle.pin('wife', 5);
    puzzle.pin('husband', 5);
    expect(puzzle.check()).toBe('wifeBusy');
    puzzle.pin('wife', 2);
    puzzle.pin('husband', 2);
    expect(puzzle.check()).toBe('doctorUnavailable');
    puzzle.pin('wife', 1);
    puzzle.pin('husband', 1);
    expect(puzzle.check()).toBe('bothBusy');
    expect(puzzle.wrongAttempts).toBe(3);
  });

  test('pins on different days are a prompt to talk, not a mistake', () => {
    const puzzle = new SchedulePuzzle(L1_SCHEDULE);
    puzzle.pin('wife', 3);
    puzzle.pin('husband', 5);
    expect(puzzle.check()).toBe('notSameDay');
    expect(puzzle.wrongAttempts).toBe(0);
  });

  test('a puzzle with no solution is rejected', () => {
    expect(() => new SchedulePuzzle({ doctorDays: [1], wifeFree: [2], husbandFree: [1] })).toThrow();
  });
});
