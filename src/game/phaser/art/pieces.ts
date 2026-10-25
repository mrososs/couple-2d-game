import { TILE } from '../../domain/tile-map.ts';
import { contactShadow, ellipse, fillRound, makeCanvas, shade, vGradient, type Ctx } from './canvas-kit.ts';

/**
 * The nursery furniture of level 3, drawn from its footprint so a rotated piece is drawn again for
 * its new footprint rather than spun on screen. The floor footprint is the bottom `w x h` cells of
 * the texture; the piece's height rises above it, as everything else in the three-quarter view.
 */

const OUT = '#3B2416';

interface PieceStyle {
  /** How tall the piece stands, in pixels above its footprint. */
  readonly height: number;
  readonly body: string;
  detail(ctx: Ctx, x: number, y: number, w: number, d: number, h: number, vertical: boolean): void;
}

const STYLES: Record<string, PieceStyle> = {
  crib: {
    height: 34,
    body: '#F1E2C6',
    detail(ctx, x, y, w, d, h, vertical) {
      // Mattress with a fitted sheet seen from above, slatted rails on the front.
      fillRound(ctx, x + 8, y + 8, w - 16, d - 12, 6, '#DDF0F5', OUT, 1.5);
      ctx.strokeStyle = 'rgba(120, 170, 190, 0.35)';
      ctx.lineWidth = 1.5;
      for (let i = 1; i < (vertical ? 6 : 4); i++) {
        const yy = y + 8 + ((d - 12) * i) / (vertical ? 6 : 4);
        ctx.beginPath();
        ctx.moveTo(x + 10, yy);
        ctx.lineTo(x + w - 10, yy);
        ctx.stroke();
      }
      ctx.strokeStyle = '#C9AE84';
      ctx.lineWidth = 3;
      for (let xx = x + 10; xx <= x + w - 10; xx += 9) {
        ctx.beginPath();
        ctx.moveTo(xx, y + d + 4);
        ctx.lineTo(xx, y + d + h - 6);
        ctx.stroke();
      }
      fillRound(ctx, x + 2, y + d - 2, w - 4, 8, 4, '#E9D3AE', OUT, 1.5);
    },
  },
  kidsWardrobe: {
    height: 92,
    body: '#E9D8BD',
    detail(ctx, x, y, w, d, h, vertical) {
      const doors = vertical ? 1 : 2;
      for (let i = 0; i < doors; i++) {
        const dw = (w - 16) / doors;
        fillRound(ctx, x + 8 + i * dw, y + d + 6, dw - 4, h - 14, 5, '#F3E5CF', OUT, 1.5);
        ellipse(ctx, x + 8 + i * dw + dw / 2 - 2, y + d + h / 2, 7, 7, i ? '#F4A6A6' : '#9ED2C6');
      }
    },
  },
  dresser: {
    height: 52,
    body: '#C8A27A',
    detail(ctx, x, y, w, d, h) {
      for (let i = 0; i < 3; i++) {
        fillRound(ctx, x + 8, y + d + 6 + i * ((h - 10) / 3), w - 16, (h - 10) / 3 - 3, 3, '#D7B48C', OUT, 1.2);
        ellipse(ctx, x + w / 2, y + d + 6 + i * ((h - 10) / 3) + (h - 10) / 6 - 1, 2.4, 2.4, '#E9C46A', OUT, 1);
      }
      ellipse(ctx, x + 18, y + d / 2, 7, 4, '#F4A6A6', OUT, 1);
    },
  },
  changingTable: {
    height: 40,
    body: '#F2E6D4',
    detail(ctx, x, y, w, d, h) {
      fillRound(ctx, x + 8, y + 6, w - 16, d - 8, 8, '#A7D3C9', OUT, 1.5);
      fillRound(ctx, x + 10, y + d + 8, w - 20, h - 16, 3, '#E8D7BF', OUT, 1.2);
    },
  },
  rockingChair: {
    height: 44,
    body: '#C99A6B',
    detail(ctx, x, y, w, d, h) {
      fillRound(ctx, x + 8, y + 4, w - 16, d - 4, 8, '#F4C7B8', OUT, 1.5);
      ctx.strokeStyle = '#8A5A3C';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + d + h - 6);
      ctx.quadraticCurveTo(x + w / 2, y + d + h + 2, x + w - 4, y + d + h - 6);
      ctx.stroke();
    },
  },
  toyShelf: {
    height: 40,
    body: '#E8C9A0',
    detail(ctx, x, y, w, d, h, vertical) {
      const bins = vertical ? 1 : 3;
      for (let i = 0; i < bins; i++) {
        const bw = (w - 16) / bins;
        fillRound(ctx, x + 8 + i * bw, y + d + 8, bw - 4, h - 14, 4, ['#9ED2C6', '#F6C177', '#F4A6A6'][i], OUT, 1.2);
      }
      ellipse(ctx, x + w / 2, y + d / 2, 6, 6, '#F6C177', OUT, 1.2);
    },
  },
};

export function pieceTextureKey(art: string, wCells: number, hCells: number): string {
  return `piece-${art}-${wCells}x${hCells}`;
}

export function pieceHeight(art: string): number {
  return STYLES[art]?.height ?? 40;
}

/** A piece whose footprint is `wCells x hCells`; the texture is that footprint plus its height. */
export function drawPiece(art: string, wCells: number, hCells: number): HTMLCanvasElement {
  const style = STYLES[art];
  if (!style) throw new Error(`No art for nursery piece '${art}'`);
  const w = wCells * TILE;
  const d = hCells * TILE;
  const h = style.height;
  const { canvas, ctx } = makeCanvas(w, d + h);
  ctx.lineJoin = 'round';
  contactShadow(ctx, w / 2, d + h - 6, w / 2 - 4, 10, 0.3);
  const x = 2;
  const ww = w - 4;
  // Top surface (the footprint, lifted by the height) and the front face beneath it.
  fillRound(ctx, x, d - 4, ww, h + 2, 6, vGradient(ctx, d, d + h, shade(style.body, -0.05), shade(style.body, -0.25)), OUT, 2);
  fillRound(ctx, x, 2, ww, d - 2, 8, vGradient(ctx, 2, d, shade(style.body, 0.18), shade(style.body, 0.02)), OUT, 2);
  style.detail(ctx, x, 2, ww, d - 6, h, hCells > wCells);
  return canvas;
}
