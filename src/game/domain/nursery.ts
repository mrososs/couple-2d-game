/**
 * Level 3's puzzles: laying out the nursery on a grid, and clearing the cot for safe sleep.
 *
 * Placement has hard rules (inside the room, no overlap, the door swing kept clear) that stop a
 * piece being put down, and softer safety rules checked when the couple inspects the room
 * together: the cot away from the window, tall furniture against a wall where it can be anchored,
 * and a clear path from the door to the cot and the changing table. The safe-sleep part follows
 * UNICEF and AAP guidance: a firm, flat mattress with a fitted sheet and nothing else in the cot.
 */

export interface Cell {
  readonly col: number;
  readonly row: number;
}

export type Rotation = 0 | 90;

export interface PieceSpec {
  readonly id: string;
  readonly name: string;
  readonly art: string;
  /** Footprint at rotation 0, in cells. */
  readonly w: number;
  readonly h: number;
  /** Needs both partners to carry. */
  readonly heavy: boolean;
  /** Tall enough to tip over: should stand against a wall to be anchored. */
  readonly anchor: boolean;
  /** Must be reachable from the door. */
  readonly reach: boolean;
}

export interface Placement {
  readonly col: number;
  readonly row: number;
  readonly rotation: Rotation;
}

export interface RoomSpec {
  readonly cols: number;
  readonly rows: number;
  /** Cells that must stay empty so the door can open. */
  readonly doorZone: readonly Cell[];
  /** The cell just inside the door, where the walkway starts. */
  readonly doorCell: Cell;
  /** Cells close to the window (cords, drafts, direct sun). */
  readonly windowZone: readonly Cell[];
}

export type PlaceError = 'outOfRoom' | 'overlap' | 'blocksDoor';

export type LayoutIssue =
  | { readonly kind: 'notPlaced'; readonly pieceId: string }
  | { readonly kind: 'cribByWindow'; readonly pieceId: string }
  | { readonly kind: 'notAnchored'; readonly pieceId: string }
  | { readonly kind: 'unreachable'; readonly pieceId: string };

export function footprint(spec: PieceSpec, rotation: Rotation): { w: number; h: number } {
  return rotation === 90 ? { w: spec.h, h: spec.w } : { w: spec.w, h: spec.h };
}

export function cellsOf(spec: PieceSpec, at: Placement): Cell[] {
  const { w, h } = footprint(spec, at.rotation);
  const cells: Cell[] = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells.push({ col: at.col + c, row: at.row + r });
  return cells;
}

const key = (c: Cell) => `${c.col},${c.row}`;

export class NurseryLayout {
  private readonly placed = new Map<string, Placement>();

  constructor(
    readonly room: RoomSpec,
    readonly pieces: readonly PieceSpec[],
  ) {}

  piece(id: string): PieceSpec {
    const piece = this.pieces.find((p) => p.id === id);
    if (!piece) throw new Error(`Unknown piece '${id}'`);
    return piece;
  }

  placementOf(id: string): Placement | undefined {
    return this.placed.get(id);
  }

  isPlaced(id: string): boolean {
    return this.placed.has(id);
  }

  /** Why a piece cannot go here, or null when it can. The piece's own cells never block it. */
  check(id: string, at: Placement): PlaceError | null {
    const spec = this.piece(id);
    const cells = cellsOf(spec, at);
    if (cells.some((c) => c.col < 0 || c.row < 0 || c.col >= this.room.cols || c.row >= this.room.rows)) return 'outOfRoom';
    const door = new Set(this.room.doorZone.map(key));
    if (cells.some((c) => door.has(key(c)))) return 'blocksDoor';
    const taken = this.occupied(id);
    if (cells.some((c) => taken.has(key(c)))) return 'overlap';
    return null;
  }

  place(id: string, at: Placement): PlaceError | null {
    const error = this.check(id, at);
    if (!error) this.placed.set(id, at);
    return error;
  }

  lift(id: string): void {
    this.placed.delete(id);
  }

  /** The piece covering a cell, if any. */
  pieceAt(cell: Cell): string | undefined {
    for (const [id, at] of this.placed) {
      if (cellsOf(this.piece(id), at).some((c) => c.col === cell.col && c.row === cell.row)) return id;
    }
    return undefined;
  }

  evaluate(): LayoutIssue[] {
    const issues: LayoutIssue[] = [];
    for (const spec of this.pieces) {
      const at = this.placed.get(spec.id);
      if (!at) {
        issues.push({ kind: 'notPlaced', pieceId: spec.id });
        continue;
      }
      const cells = cellsOf(spec, at);
      if (spec.id === 'crib') {
        const windowCells = new Set(this.room.windowZone.map(key));
        if (cells.some((c) => windowCells.has(key(c)))) issues.push({ kind: 'cribByWindow', pieceId: spec.id });
      }
      if (spec.anchor && !this.touchesWall(cells)) issues.push({ kind: 'notAnchored', pieceId: spec.id });
      if (spec.reach && !this.reachable(spec.id)) issues.push({ kind: 'unreachable', pieceId: spec.id });
    }
    return issues;
  }

  private occupied(except?: string): Set<string> {
    const taken = new Set<string>();
    for (const [id, at] of this.placed) {
      if (id === except) continue;
      for (const c of cellsOf(this.piece(id), at)) taken.add(key(c));
    }
    return taken;
  }

  private touchesWall(cells: readonly Cell[]): boolean {
    return cells.some((c) => c.col === 0 || c.row === 0 || c.col === this.room.cols - 1 || c.row === this.room.rows - 1);
  }

  /** Whether a free cell beside the piece can be walked to from the door. */
  private reachable(id: string): boolean {
    const taken = this.occupied();
    const start = this.room.doorCell;
    if (taken.has(key(start))) return false;
    const seen = new Set<string>([key(start)]);
    const queue: Cell[] = [start];
    const own = new Set(cellsOf(this.piece(id), this.placed.get(id)!).map(key));
    while (queue.length) {
      const cell = queue.shift()!;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { col: cell.col + dc, row: cell.row + dr };
        if (own.has(key(next))) return true;
        if (next.col < 0 || next.row < 0 || next.col >= this.room.cols || next.row >= this.room.rows) continue;
        const k = key(next);
        if (seen.has(k) || taken.has(k)) continue;
        seen.add(k);
        queue.push(next);
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Safe sleep

export interface BeddingItem {
  readonly id: string;
  readonly name: string;
  readonly art: string;
  /** False for what belongs in a cot: the fitted sheet on a firm mattress. */
  readonly unsafe: boolean;
  /** One short line on why, shown when it is found. */
  readonly why: string;
}

export class SafeSleepCheck {
  private readonly inCrib: Set<string>;

  constructor(readonly items: readonly BeddingItem[]) {
    this.inCrib = new Set(items.map((i) => i.id));
  }

  item(id: string): BeddingItem {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error(`Unknown bedding '${id}'`);
    return item;
  }

  isInCrib(id: string): boolean {
    return this.inCrib.has(id);
  }

  contents(): BeddingItem[] {
    return this.items.filter((i) => this.inCrib.has(i.id));
  }

  takeOut(id: string): BeddingItem {
    this.inCrib.delete(id);
    return this.item(id);
  }

  putBack(id: string): void {
    this.item(id);
    this.inCrib.add(id);
  }

  /** Unsafe things still in the cot, and safe things missing from it. */
  findings(): { unsafeLeft: BeddingItem[]; safeMissing: BeddingItem[] } {
    return {
      unsafeLeft: this.items.filter((i) => i.unsafe && this.inCrib.has(i.id)),
      safeMissing: this.items.filter((i) => !i.unsafe && !this.inCrib.has(i.id)),
    };
  }

  isSafe(): boolean {
    const { unsafeLeft, safeMissing } = this.findings();
    return unsafeLeft.length === 0 && safeMissing.length === 0;
  }
}
