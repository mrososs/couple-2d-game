import { TILE, cellAt, floorUnder, isExterior, isFloor, isWalkable, type FloorChar, type TileMap } from '../../domain/tile-map.ts';
import { makeCanvas, seeded, shade, type Ctx } from './canvas-kit.ts';

/**
 * The static part of a level - floors, walls, wallpaper, skirting and soft shadows - painted once
 * into a single canvas. One image for the whole floor plan is far cheaper on a phone than a sprite
 * per tile, and it lets the shading run across tile edges.
 */

const WALL_TOP = '#5A3D30';
const WALL_TOP_EDGE = '#7A5644';
const EXTERIOR = '#2E2420';

interface Wallpaper {
  readonly base: string;
  readonly pattern: string;
  readonly kind: 'damask' | 'stripes' | 'stars' | 'tiles' | 'plain' | 'brick' | 'shop';
}

const WALLPAPER: Record<FloorChar, Wallpaper> = {
  '.': { base: '#F2DFC0', pattern: '#E6CCA4', kind: 'damask' },
  b: { base: '#E9C9C3', pattern: '#DDB2AB', kind: 'stripes' },
  n: { base: '#D4EBDD', pattern: '#FFFFFF', kind: 'stars' },
  k: { base: '#E4EEF1', pattern: '#C9DCE2', kind: 'tiles' },
  h: { base: '#EFD9B4', pattern: '#E0C397', kind: 'plain' },
  s: { base: '#F4F1E8', pattern: '#9CCB9B', kind: 'shop' },
  x: { base: '#B9876A', pattern: '#A37155', kind: 'brick' },
};

export function drawBackground(map: TileMap): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(map.cols * TILE, map.rows * TILE);
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const cell = cellAt(map, col, row)!;
      const x = col * TILE;
      const y = row * TILE;
      if (isWalkable(cell)) drawFloorTile(ctx, floorUnder(map, col, row), x, y, col, row);
      if (cell === 'd') drawThreshold(ctx, map, col, row, x, y);
    }
  }
  drawFloorShadows(ctx, map);
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const cell = cellAt(map, col, row)!;
      const x = col * TILE;
      const y = row * TILE;
      if (cell === 'W') drawWallFace(ctx, map, col, row, x, y);
      else if (cell === '#') drawWallTop(ctx, map, col, row, x, y);
    }
  }
  drawDoorFrames(ctx, map);
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// Floors

function drawFloorTile(ctx: Ctx, floor: FloorChar, x: number, y: number, col: number, row: number): void {
  const rand = seeded(col * 7919 + row * 104729 + floor.charCodeAt(0));
  switch (floor) {
    case '.':
      planks(ctx, x, y, col, row, '#C68C58', '#B47A47', rand, 'herringbone');
      break;
    case 'b':
      planks(ctx, x, y, col, row, '#D7A574', '#C8935F', rand, 'straight');
      break;
    case 'n':
      planks(ctx, x, y, col, row, '#EAD9B8', '#DDC8A2', rand, 'straight');
      break;
    case 'k':
      checker(ctx, x, y, col, row, '#F1E8D8', '#D8C6A6');
      break;
    case 'h':
      cementTile(ctx, x, y);
      break;
    case 's':
      shopTile(ctx, x, y, col, row);
      break;
    case 'x':
      sidewalk(ctx, x, y, col, row, rand);
      break;
  }
}

function planks(ctx: Ctx, x: number, y: number, col: number, row: number, light: string, dark: string, rand: () => number, style: 'straight' | 'herringbone'): void {
  ctx.fillStyle = light;
  ctx.fillRect(x, y, TILE, TILE);
  if (style === 'herringbone') {
    const half = TILE / 2;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const px = x + i * half;
        const py = y + j * half;
        const horizontal = (col + row + i + j) % 2 === 0;
        ctx.fillStyle = shade(rand() > 0.5 ? light : dark, (rand() - 0.5) * 0.08);
        ctx.fillRect(px + 0.5, py + 0.5, half - 1, half - 1);
        ctx.strokeStyle = 'rgba(90, 50, 25, 0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(px, py + half / 2);
          ctx.lineTo(px + half, py + half / 2);
        } else {
          ctx.moveTo(px + half / 2, py);
          ctx.lineTo(px + half / 2, py + half);
        }
        ctx.stroke();
      }
    }
  } else {
    const plankH = TILE / 4;
    for (let i = 0; i < 4; i++) {
      const py = y + i * plankH;
      ctx.fillStyle = shade(i % 2 ? dark : light, (rand() - 0.5) * 0.06);
      ctx.fillRect(x, py, TILE, plankH - 1);
      // Staggered seams.
      const seam = x + ((row * 4 + i) * 17 + col * 29) % TILE;
      ctx.fillStyle = 'rgba(90, 50, 25, 0.2)';
      ctx.fillRect(seam, py, 1, plankH - 1);
    }
  }
  // Grain.
  ctx.strokeStyle = 'rgba(110, 60, 30, 0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const gy = y + rand() * TILE;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.bezierCurveTo(x + TILE / 3, gy + 2, x + (2 * TILE) / 3, gy - 2, x + TILE, gy);
    ctx.stroke();
  }
}

function checker(ctx: Ctx, x: number, y: number, col: number, row: number, a: string, b: string): void {
  const half = TILE / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j + col + row) % 2 === 0 ? a : b;
      ctx.fillRect(x + i * half, y + j * half, half, half);
    }
  }
  ctx.strokeStyle = 'rgba(120, 100, 80, 0.25)';
  ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
}

/** The patterned cement tiles of an old Cairo entrance hall. */
function cementTile(ctx: Ctx, x: number, y: number): void {
  ctx.fillStyle = '#F1E3C8';
  ctx.fillRect(x, y, TILE, TILE);
  const c = TILE / 2;
  ctx.save();
  ctx.translate(x + c, y + c);
  ctx.fillStyle = '#C4573A';
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.quadraticCurveTo(10, -12, 0, -21);
    ctx.quadraticCurveTo(-10, -12, 0, -4);
    ctx.fill();
  }
  ctx.fillStyle = '#2F6E6A';
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#2F6E6A';
  for (const [cx, cy] of [[x, y], [x + TILE, y], [x, y + TILE], [x + TILE, y + TILE]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(80, 50, 30, 0.25)';
  ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
}

function shopTile(ctx: Ctx, x: number, y: number, col: number, row: number): void {
  ctx.fillStyle = (col + row) % 2 ? '#EEF1EE' : '#F7F8F4';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.strokeStyle = 'rgba(120, 140, 130, 0.25)';
  ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
}

function sidewalk(ctx: Ctx, x: number, y: number, col: number, row: number, rand: () => number): void {
  ctx.fillStyle = shade('#CDBFA8', (rand() - 0.5) * 0.08);
  ctx.fillRect(x, y, TILE, TILE);
  ctx.strokeStyle = 'rgba(90, 70, 50, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
  if ((col + row) % 3 === 0) {
    ctx.strokeStyle = 'rgba(90, 70, 50, 0.15)';
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 30);
    ctx.lineTo(x + 20, y + 26);
    ctx.stroke();
  }
}

function drawThreshold(ctx: Ctx, map: TileMap, col: number, row: number, x: number, y: number): void {
  const vertical = isWalkable(cellAt(map, col - 1, row)) && isWalkable(cellAt(map, col + 1, row));
  ctx.fillStyle = 'rgba(240, 232, 220, 0.85)';
  if (vertical) ctx.fillRect(x + TILE / 2 - 5, y, 10, TILE);
  else if (cellAt(map, col, row + 1) !== 'd') ctx.fillRect(x, y + TILE - 8, TILE, 8);
}

/** Ambient occlusion where floor meets wall: walls cast soft shadows down and to the right. */
function drawFloorShadows(ctx: Ctx, map: TileMap): void {
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      if (!isWalkable(cellAt(map, col, row))) continue;
      const x = col * TILE;
      const y = row * TILE;
      const above = cellAt(map, col, row - 1);
      if (above === 'W' || above === '#') {
        const g = ctx.createLinearGradient(0, y, 0, y + 18);
        g.addColorStop(0, 'rgba(50, 25, 10, 0.32)');
        g.addColorStop(1, 'rgba(50, 25, 10, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, TILE, 18);
      }
      const left = cellAt(map, col - 1, row);
      if (left === '#' || left === 'W') {
        const g = ctx.createLinearGradient(x, 0, x + 14, 0);
        g.addColorStop(0, 'rgba(50, 25, 10, 0.28)');
        g.addColorStop(1, 'rgba(50, 25, 10, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, 14, TILE);
      }
      const right = cellAt(map, col + 1, row);
      if (right === '#' || right === 'W') {
        const g = ctx.createLinearGradient(x + TILE, 0, x + TILE - 8, 0);
        g.addColorStop(0, 'rgba(50, 25, 10, 0.18)');
        g.addColorStop(1, 'rgba(50, 25, 10, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + TILE - 8, y, 8, TILE);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Walls

function drawWallTop(ctx: Ctx, map: TileMap, col: number, row: number, x: number, y: number): void {
  if (isExterior(map, col, row)) {
    ctx.fillStyle = EXTERIOR;
    ctx.fillRect(x, y, TILE, TILE);
    const rand = seeded(col * 31 + row * 17);
    ctx.fillStyle = 'rgba(255, 220, 170, 0.04)';
    for (let i = 0; i < 3; i++) ctx.fillRect(x + rand() * TILE, y + rand() * TILE, 2, 2);
    return;
  }
  ctx.fillStyle = WALL_TOP;
  ctx.fillRect(x, y, TILE, TILE);
  // A lighter rim wherever the wall top meets something walkable or a face, so the plan reads.
  ctx.fillStyle = WALL_TOP_EDGE;
  const solidish = (c: string | undefined) => c === '#';
  if (!solidish(cellAt(map, col, row + 1))) ctx.fillRect(x, y + TILE - 5, TILE, 5);
  if (!solidish(cellAt(map, col, row - 1)) && row > 0) ctx.fillRect(x, y, TILE, 3);
  if (!solidish(cellAt(map, col - 1, row)) && col > 0) ctx.fillRect(x, y, 4, TILE);
  if (!solidish(cellAt(map, col + 1, row)) && col < map.cols - 1) ctx.fillRect(x + TILE - 4, y, 4, TILE);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(x + 6, y + 6, TILE - 12, 2);
}

function drawWallFace(ctx: Ctx, map: TileMap, col: number, row: number, x: number, y: number): void {
  const floor = floorUnder(map, col, row + 1);
  const paper = WALLPAPER[floor];
  const g = ctx.createLinearGradient(0, y, 0, y + TILE);
  g.addColorStop(0, shade(paper.base, -0.06));
  g.addColorStop(1, shade(paper.base, 0.04));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, TILE, TILE - 8);
  ctx.clip();
  switch (paper.kind) {
    case 'damask':
      ctx.fillStyle = paper.pattern;
      for (const [dx, dy] of [[12, 12], [36, 28]]) {
        const cx = x + dx;
        const cy = y + dy;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 7);
        ctx.quadraticCurveTo(cx + 6, cy, cx, cy + 7);
        ctx.quadraticCurveTo(cx - 6, cy, cx, cy - 7);
        ctx.fill();
      }
      break;
    case 'stripes':
      ctx.fillStyle = paper.pattern;
      for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 12 + 4, y, 4, TILE);
      break;
    case 'stars':
      ctx.fillStyle = paper.pattern;
      for (const [dx, dy] of [[10, 12], [34, 26], [22, 34]]) star(ctx, x + dx, y + dy, 3.5);
      break;
    case 'tiles':
      ctx.strokeStyle = paper.pattern;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * 12, y + 14);
        ctx.lineTo(x + i * 12, y + TILE);
        ctx.stroke();
      }
      for (let j = 14; j < TILE; j += 12) {
        ctx.beginPath();
        ctx.moveTo(x, y + j);
        ctx.lineTo(x + TILE, y + j);
        ctx.stroke();
      }
      break;
    case 'shop':
      ctx.fillStyle = paper.pattern;
      ctx.fillRect(x, y + 6, TILE, 8);
      break;
    case 'brick':
      ctx.strokeStyle = shade(paper.base, -0.25);
      ctx.lineWidth = 1.5;
      for (let j = 0; j < 4; j++) {
        const by = y + j * 10 + 2;
        ctx.beginPath();
        ctx.moveTo(x, by);
        ctx.lineTo(x + TILE, by);
        ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const bx = x + ((i * 18 + (j % 2) * 9) % TILE);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx, by + 10);
          ctx.stroke();
        }
      }
      break;
    default:
      break;
  }
  ctx.restore();
  // Picture rail near the top and a wooden skirting board at the floor.
  ctx.fillStyle = 'rgba(120, 80, 50, 0.25)';
  ctx.fillRect(x, y + 3, TILE, 2);
  ctx.fillStyle = '#8A5A3C';
  ctx.fillRect(x, y + TILE - 8, TILE, 8);
  ctx.fillStyle = '#A8734F';
  ctx.fillRect(x, y + TILE - 8, TILE, 2);
  // Where a face meets a wall end, a vertical shadow keeps the corner crisp.
  if (cellAt(map, col - 1, row) === '#') {
    const s = ctx.createLinearGradient(x, 0, x + 10, 0);
    s.addColorStop(0, 'rgba(40, 20, 10, 0.3)');
    s.addColorStop(1, 'rgba(40, 20, 10, 0)');
    ctx.fillStyle = s;
    ctx.fillRect(x, y, 10, TILE);
  }
  if (cellAt(map, col + 1, row) === '#') {
    const s = ctx.createLinearGradient(x + TILE, 0, x + TILE - 10, 0);
    s.addColorStop(0, 'rgba(40, 20, 10, 0.22)');
    s.addColorStop(1, 'rgba(40, 20, 10, 0)');
    ctx.fillStyle = s;
    ctx.fillRect(x + TILE - 10, y, 10, TILE);
  }
}

/** Wooden frames either side of a doorway cut through a wall. */
function drawDoorFrames(ctx: Ctx, map: TileMap): void {
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      if (cellAt(map, col, row) !== 'd') continue;
      const x = col * TILE;
      const y = row * TILE;
      const left = cellAt(map, col - 1, row);
      const right = cellAt(map, col + 1, row);
      ctx.fillStyle = '#7B4B2E';
      if (left === 'W' || left === '#') ctx.fillRect(x - 6, y, 7, TILE);
      if (right === 'W' || right === '#') ctx.fillRect(x + TILE - 1, y, 7, TILE);
      const up = cellAt(map, col, row - 1);
      const down = cellAt(map, col, row + 1);
      if ((up === 'W' || up === '#') && !isFloor(up)) {
        ctx.fillStyle = '#7B4B2E';
        ctx.fillRect(x, y - 3, TILE, 6);
      }
      if (down === '#' || down === 'W') {
        ctx.fillStyle = '#7B4B2E';
        ctx.fillRect(x, y + TILE - 3, TILE, 6);
      }
    }
  }
}

function star(ctx: Ctx, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
