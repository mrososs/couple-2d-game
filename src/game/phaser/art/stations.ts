import { DAYS } from '../../domain/planning.ts';
import { ellipse, fillRound, makeCanvas, vGradient, type Ctx } from './canvas-kit.ts';
import { drawIcon } from './items.ts';

/**
 * The puzzle stations that hang on walls: level 1's planning board and calendar, level 2's
 * shopping list. Drawn per level because they carry the players' names and the week's days.
 */

const OUT = '#3B2416';
const FONT = '"Baloo Bhaijaan 2", "Segoe UI", Tahoma, sans-serif';

function arabicText(ctx: Ctx, text: string, x: number, y: number, size: number, color: string, weight = 800): void {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.fillText(text, x, y);
  ctx.restore();
}

export const BOARD_LANE_W = 132;

/** A cork board with three lanes, right to left: the wife, together, the husband. */
export function drawPlanBoard(names: { wife: string; husband: string }): HTMLCanvasElement {
  const w = BOARD_LANE_W * 3 + 16;
  const h = 88;
  const { canvas, ctx } = makeCanvas(w, h);
  fillRound(ctx, 2, 2, w - 4, h - 4, 8, '#8A5A3C', OUT, 2.5);
  fillRound(ctx, 8, 8, w - 16, h - 16, 4, vGradient(ctx, 8, h - 8, '#D9AE7C', '#C99A66'));
  // Cork speckles.
  ctx.fillStyle = 'rgba(120, 70, 30, 0.25)';
  for (let i = 0; i < 90; i++) ctx.fillRect(10 + ((i * 53) % (w - 20)), 10 + ((i * 29) % (h - 20)), 2, 2);
  const lanes: [string, string][] = [
    [names.husband, '#3E7CB1'],
    ['مع بعض', '#8E6BBF'],
    [names.wife, '#E8735A'],
  ];
  lanes.forEach(([label, color], i) => {
    const x = 8 + i * BOARD_LANE_W;
    fillRound(ctx, x + 4, 11, BOARD_LANE_W - 8, 18, 6, color, OUT, 1.5);
    arabicText(ctx, label, x + BOARD_LANE_W / 2, 21, 13, '#FFF8EC');
    if (i > 0) {
      ctx.strokeStyle = 'rgba(59, 36, 22, 0.35)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 32);
      ctx.lineTo(x, h - 10);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  return canvas;
}

export const CALENDAR_CELL_W = 46;

/** The week on the living-room wall, Saturday on the right; the doctor's days carry a heart. */
export function drawCalendar(doctorDays: readonly number[]): HTMLCanvasElement {
  const w = CALENDAR_CELL_W * DAYS.length + 16;
  const h = 86;
  const { canvas, ctx } = makeCanvas(w, h);
  fillRound(ctx, 2, 2, w - 4, h - 4, 8, '#FFFDF6', OUT, 2.5);
  fillRound(ctx, 2, 2, w - 4, 20, 8, '#E85D5D', OUT, 2);
  arabicText(ctx, 'مواعيد الأسبوع', w / 2, 13, 13, '#FFF8EC');
  DAYS.forEach((day, i) => {
    const x = w - 8 - (i + 1) * CALENDAR_CELL_W;
    fillRound(ctx, x + 2, 26, CALENDAR_CELL_W - 4, h - 32, 5, doctorDays.includes(i) ? '#FDE2E2' : '#F6EFE3', 'rgba(59,36,22,0.4)', 1.2);
    arabicText(ctx, day, x + CALENDAR_CELL_W / 2, 36, 11, OUT, 600);
    if (doctorDays.includes(i)) drawIcon(ctx, 'hospital', x + CALENDAR_CELL_W / 2, 60, 18);
  });
  return canvas;
}

/** The pin each partner pushes into a day. */
export function drawPin(color: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(20, 26);
  ctx.strokeStyle = '#8A8F96';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(10, 12);
  ctx.lineTo(10, 25);
  ctx.stroke();
  ellipse(ctx, 10, 9, 8, 8, color, OUT, 2);
  ellipse(ctx, 7.5, 6.5, 2.2, 2.2, 'rgba(255,255,255,0.7)');
  return canvas;
}

/** Level 2's list of needs, pinned by the front door. */
export function drawNeedsList(): HTMLCanvasElement {
  const w = 132;
  const h = 86;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(0.03);
  fillRound(ctx, -w / 2 + 6, -h / 2 + 4, w - 12, h - 8, 4, '#FFFDF2', OUT, 2);
  ctx.strokeStyle = 'rgba(62, 124, 177, 0.35)';
  for (let y = -h / 2 + 22; y < h / 2 - 6; y += 11) {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 12, y);
    ctx.lineTo(w / 2 - 12, y);
    ctx.stroke();
  }
  ctx.restore();
  arabicText(ctx, 'قايمة البيبي', w / 2, 16, 12, '#C4553F');
  const icons = ['baby', 'heart', 'moon', 'hospital', 'star'] as const;
  icons.forEach((icon, i) => drawIcon(ctx, icon, 22 + i * 22, 50, 16));
  ellipse(ctx, w / 2, 6, 4, 4, '#E85D5D', OUT, 1.5);
  return canvas;
}
