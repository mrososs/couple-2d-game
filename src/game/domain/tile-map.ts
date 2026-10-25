/**
 * The apartment (and the shop) as a grid of tiles, built from room rectangles and doorways rather
 * than drawn by hand, so a level can declare its map as data. Pure TypeScript: the renderer and the
 * physics read it, and the tests check it.
 *
 * Cell legend:
 *   '#' wall top (solid)          'W' wall face, the visible front of a wall (solid)
 *   'd' doorway (walkable)        '.' living room   'b' bedroom   'n' nursery   'k' kitchen
 *   'h' entrance hall             's' shop          'x' street
 */

export const TILE = 48;

export type FloorChar = '.' | 'b' | 'n' | 'k' | 'h' | 's' | 'x';
export type Cell = FloorChar | '#' | 'W' | 'd';

export interface RoomSpec {
  readonly id: string;
  readonly floor: FloorChar;
  /** Interior, in tiles. The wall face is drawn on the row above `y`. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface DoorSpec {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface MapSpec {
  readonly cols: number;
  readonly rows: number;
  readonly rooms: readonly RoomSpec[];
  readonly doors: readonly DoorSpec[];
}

export interface TileMap {
  readonly cols: number;
  readonly rows: number;
  readonly cells: Cell[][];
  readonly rooms: readonly RoomSpec[];
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const FLOORS = new Set<string>(['.', 'b', 'n', 'k', 'h', 's', 'x']);

export function isFloor(cell: Cell | undefined): cell is FloorChar {
  return cell !== undefined && FLOORS.has(cell);
}

export function isWalkable(cell: Cell | undefined): boolean {
  return cell === 'd' || isFloor(cell);
}

export function buildMap(spec: MapSpec): TileMap {
  const cells: Cell[][] = Array.from({ length: spec.rows }, () => Array<Cell>(spec.cols).fill('#'));
  for (const room of spec.rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) cells[y][x] = room.floor;
    }
    const faceRow = room.y - 1;
    if (faceRow >= 0) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (cells[faceRow][x] === '#') cells[faceRow][x] = 'W';
      }
    }
  }
  for (const door of spec.doors) {
    for (let y = door.y; y < door.y + door.h; y++) {
      for (let x = door.x; x < door.x + door.w; x++) cells[y][x] = 'd';
    }
  }
  return { cols: spec.cols, rows: spec.rows, cells, rooms: spec.rooms };
}

export function cellAt(map: TileMap, col: number, row: number): Cell | undefined {
  return map.cells[row]?.[col];
}

/** The floor a doorway continues: the room it opens into below, else above, else either side. */
export function floorUnder(map: TileMap, col: number, row: number): FloorChar {
  const cell = cellAt(map, col, row);
  if (isFloor(cell)) return cell;
  for (const [dx, dy] of [[0, 1], [0, 2], [0, -1], [0, -2], [1, 0], [-1, 0], [2, 0], [-2, 0]] as const) {
    const near = cellAt(map, col + dx, row + dy);
    if (isFloor(near)) return near;
  }
  return '.';
}

/**
 * The solid cells merged into as few rectangles as a greedy row-then-column sweep finds, in tiles.
 * Fewer bodies keep Arcade Physics cheap on a phone.
 */
export function solidRects(map: TileMap): Rect[] {
  const used = map.cells.map((row) => row.map(() => false));
  const solid = (x: number, y: number) => !isWalkable(map.cells[y][x]) && !used[y][x];
  const rects: Rect[] = [];
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      if (!solid(x, y)) continue;
      let w = 1;
      while (x + w < map.cols && solid(x + w, y)) w++;
      let h = 1;
      grow: while (y + h < map.rows) {
        for (let i = 0; i < w; i++) if (!solid(x + i, y + h)) break grow;
        h++;
      }
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[yy][xx] = true;
      rects.push({ x, y, w, h });
    }
  }
  return rects;
}

/** A wall cell with no walkable cell near it is outside the building. */
export function isExterior(map: TileMap, col: number, row: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (isWalkable(cellAt(map, col + dx, row + dy))) return false;
      const near = cellAt(map, col + dx, row + dy);
      if (near === 'W') return false;
    }
  }
  return true;
}

export function roomAt(map: TileMap, col: number, row: number): RoomSpec | undefined {
  return map.rooms.find((r) => col >= r.x && col < r.x + r.w && row >= r.y && row < r.y + r.h);
}

export function tileCenter(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}

/** The apartment every level is set in: bedroom, nursery and kitchen above a long living room. */
export const APARTMENT: MapSpec = {
  cols: 40,
  rows: 22,
  rooms: [
    { id: 'bedroom', floor: 'b', x: 1, y: 2, w: 12, h: 7 },
    { id: 'nursery', floor: 'n', x: 14, y: 2, w: 13, h: 7 },
    { id: 'kitchen', floor: 'k', x: 28, y: 2, w: 11, h: 7 },
    { id: 'living', floor: '.', x: 1, y: 11, w: 31, h: 10 },
    { id: 'hall', floor: 'h', x: 32, y: 11, w: 7, h: 10 },
  ],
  doors: [
    { x: 5, y: 9, w: 2, h: 2 },
    { x: 19, y: 9, w: 2, h: 2 },
    { x: 32, y: 9, w: 2, h: 2 },
  ],
};

/** The apartment with its front door open onto the street and the baby shop across it. */
export const APARTMENT_AND_SHOP: MapSpec = {
  cols: 66,
  rows: 22,
  rooms: [
    ...APARTMENT.rooms,
    { id: 'street', floor: 'x', x: 40, y: 11, w: 5, h: 10 },
    { id: 'shop', floor: 's', x: 46, y: 5, w: 19, h: 16 },
    { id: 'storeroom', floor: 's', x: 56, y: 1, w: 8, h: 3 },
  ],
  doors: [
    ...APARTMENT.doors,
    { x: 39, y: 16, w: 1, h: 3 },
    { x: 45, y: 16, w: 1, h: 3 },
    // The storeroom's opening; a roller shutter closes it unless someone stands on the switch.
    { x: 58, y: 4, w: 3, h: 1 },
  ],
};
