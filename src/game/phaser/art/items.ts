import { capsule, ellipse, fillRound, makeCanvas, roundRect, shade, vGradient, type Ctx } from './canvas-kit.ts';

/**
 * Things a character can pick up and carry over their head - task cards, baby products, the loose
 * bedding of the safe-sleep puzzle - plus the icons they and the HUD use, and the HUD's own shapes.
 */

const OUT = '#3B2416';

export type IconName =
  | 'calendar'
  | 'cart'
  | 'broom'
  | 'box'
  | 'pot'
  | 'hospital'
  | 'money'
  | 'phone'
  | 'moon'
  | 'family'
  | 'car'
  | 'heart'
  | 'baby'
  | 'laptop'
  | 'star'
  | 'check'
  | 'cross'
  | 'hand'
  | 'rotate'
  | 'swap'
  | 'pause'
  | 'bulb'
  | 'shield';

export function drawIcon(ctx: Ctx, name: IconName, cx: number, cy: number, s: number, color = '#3B2416'): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s / 32, s / 32);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  switch (name) {
    case 'calendar':
      fillRound(ctx, -12, -10, 24, 22, 3, '#FFFFFF', color, 2.5);
      ctx.fillStyle = '#E85D5D';
      ctx.fillRect(-12, -10, 24, 7);
      ctx.fillStyle = color;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ctx.fillRect(-8 + i * 6, 0 + j * 5, 3, 3);
      capsule(ctx, -6, -13, -6, -8, 2.5, color);
      capsule(ctx, 6, -13, 6, -8, 2.5, color);
      break;
    case 'cart':
      ctx.beginPath();
      ctx.moveTo(-14, -10);
      ctx.lineTo(-9, -10);
      ctx.lineTo(-5, 6);
      ctx.lineTo(11, 6);
      ctx.lineTo(14, -5);
      ctx.lineTo(-7, -5);
      ctx.stroke();
      ellipse(ctx, -3, 11, 2.6, 2.6, color);
      ellipse(ctx, 9, 11, 2.6, 2.6, color);
      break;
    case 'broom':
      capsule(ctx, 8, -14, -2, 4, 3, '#8A5A3C');
      ctx.beginPath();
      ctx.moveTo(-2, 2);
      ctx.lineTo(-14, 10);
      ctx.lineTo(-6, 15);
      ctx.lineTo(4, 6);
      ctx.closePath();
      ctx.fillStyle = '#E9C46A';
      ctx.fill();
      ctx.stroke();
      break;
    case 'box':
      fillRound(ctx, -12, -8, 24, 20, 2, '#D9A86C', color, 2.5);
      ctx.fillStyle = '#F2D6A8';
      ctx.fillRect(-3, -8, 6, 20);
      capsule(ctx, -16, -12, -11, -14, 2, color);
      capsule(ctx, 16, -12, 11, -14, 2, color);
      break;
    case 'pot':
      fillRound(ctx, -12, -4, 24, 16, 5, '#C0504D', color, 2.5);
      capsule(ctx, -15, -2, -12, -2, 3, color);
      capsule(ctx, 12, -2, 15, -2, 3, color);
      fillRound(ctx, -13, -8, 26, 5, 2, '#9C3B39', color, 2);
      capsule(ctx, -4, -14, -2, -18, 2, 'rgba(120,120,120,0.7)');
      capsule(ctx, 4, -14, 6, -18, 2, 'rgba(120,120,120,0.7)');
      break;
    case 'hospital':
      fillRound(ctx, -12, -12, 24, 24, 5, '#FFFFFF', color, 2.5);
      ctx.fillStyle = '#E85D5D';
      ctx.fillRect(-3, -8, 6, 16);
      ctx.fillRect(-8, -3, 16, 6);
      break;
    case 'money':
      fillRound(ctx, -14, -8, 28, 16, 3, '#9BD39B', color, 2.5);
      ellipse(ctx, 0, 0, 5, 5, '#5FA65F', color, 2);
      break;
    case 'phone':
      fillRound(ctx, -8, -14, 16, 28, 4, '#2C2F36', color, 2);
      fillRound(ctx, -6, -10, 12, 18, 2, '#7FB3D5');
      ellipse(ctx, 0, 11, 1.6, 1.6, '#FFFFFF');
      break;
    case 'moon':
      ctx.beginPath();
      ctx.arc(0, 0, 12, Math.PI * 0.35, Math.PI * 1.65);
      ctx.quadraticCurveTo(-4, 0, 4, 10);
      ctx.fillStyle = '#F2C14E';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('z', 6, -6);
      break;
    case 'family':
      ellipse(ctx, -8, -5, 5, 5, '#D9A07A', color, 2);
      ellipse(ctx, 8, -5, 5, 5, '#C98B62', color, 2);
      ellipse(ctx, 0, 1, 3.5, 3.5, '#E8B796', color, 1.6);
      fillRound(ctx, -14, 2, 12, 12, 5, '#E8735A', color, 2);
      fillRound(ctx, 2, 2, 12, 12, 5, '#3E7CB1', color, 2);
      break;
    case 'car':
      fillRound(ctx, -14, -2, 28, 10, 4, '#3E7CB1', color, 2.5);
      fillRound(ctx, -8, -9, 16, 9, 3, '#7FB3D5', color, 2.5);
      ellipse(ctx, -8, 9, 3.5, 3.5, color);
      ellipse(ctx, 8, 9, 3.5, 3.5, color);
      break;
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.bezierCurveTo(-16, 0, -10, -14, 0, -6);
      ctx.bezierCurveTo(10, -14, 16, 0, 0, 12);
      ctx.fillStyle = '#E85D75';
      ctx.fill();
      ctx.stroke();
      break;
    case 'baby':
      ellipse(ctx, 0, -4, 9, 9, '#F1C6A8', color, 2.5);
      ellipse(ctx, -3, -5, 1.2, 1.6, color);
      ellipse(ctx, 3, -5, 1.2, 1.6, color);
      fillRound(ctx, -10, 4, 20, 10, 5, '#9ED2C6', color, 2.5);
      break;
    case 'laptop':
      fillRound(ctx, -11, -10, 22, 15, 2, '#2C2F36', color, 2);
      fillRound(ctx, -8, -7, 16, 9, 1, '#7FB3D5');
      fillRound(ctx, -15, 5, 30, 5, 2, '#B9BEC6', color, 2);
      break;
    case 'star':
      star(ctx, 0, 0, 14, '#F2C14E', color);
      break;
    case 'check':
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(-3, 8);
      ctx.lineTo(11, -8);
      ctx.stroke();
      break;
    case 'cross':
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-8, -8);
      ctx.lineTo(8, 8);
      ctx.moveTo(8, -8);
      ctx.lineTo(-8, 8);
      ctx.stroke();
      break;
    case 'hand':
      fillRound(ctx, -8, -4, 16, 16, 6, '#FFE0C2', color, 2.5);
      for (let i = 0; i < 4; i++) fillRound(ctx, -8 + i * 4.2, -14 + Math.abs(i - 1.5) * 1.5, 4, 12, 2, '#FFE0C2', color, 2);
      fillRound(ctx, 6, -2, 9, 5, 2.5, '#FFE0C2', color, 2);
      break;
    case 'rotate':
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 10, Math.PI * 0.2, Math.PI * 1.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(10, -10);
      ctx.lineTo(11, 0);
      ctx.lineTo(2, -3);
      ctx.closePath();
      ctx.fill();
      break;
    case 'swap':
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-12, -5);
      ctx.lineTo(10, -5);
      ctx.moveTo(12, 5);
      ctx.lineTo(-10, 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(14, -5);
      ctx.lineTo(7, -11);
      ctx.lineTo(7, 1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-14, 5);
      ctx.lineTo(-7, -1);
      ctx.lineTo(-7, 11);
      ctx.closePath();
      ctx.fill();
      break;
    case 'pause':
      ctx.fillRect(-8, -10, 5, 20);
      ctx.fillRect(3, -10, 5, 20);
      break;
    case 'bulb':
      ellipse(ctx, 0, -4, 9, 9, '#FFE07A', color, 2.5);
      fillRound(ctx, -5, 5, 10, 7, 2, '#B9BEC6', color, 2);
      break;
    case 'shield':
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(12, -9);
      ctx.quadraticCurveTo(12, 8, 0, 14);
      ctx.quadraticCurveTo(-12, 8, -12, -9);
      ctx.closePath();
      ctx.fillStyle = '#7FC8A9';
      ctx.fill();
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function star(ctx: Ctx, cx: number, cy: number, r: number, fill: string, stroke?: string): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.48 : r;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

/** A task card: a pinned paper note with an icon, tinted by who could take it on. */
export function drawCard(icon: IconName, tint: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(52, 56);
  ctx.save();
  ctx.translate(26, 30);
  ctx.rotate(-0.05);
  fillRound(ctx, -22, -22, 44, 46, 5, '#FFFBF0', OUT, 2);
  ctx.fillStyle = tint;
  roundRect(ctx, -22, -22, 44, 9, 4);
  ctx.fill();
  drawIcon(ctx, icon, 0, 5, 26);
  ctx.restore();
  ellipse(ctx, 26, 8, 4.5, 4.5, '#E85D5D', OUT, 1.5);
  return canvas;
}

export type ItemArtKey =
  | 'diapers-s'
  | 'diapers-m'
  | 'diapers-l'
  | 'clothes'
  | 'swaddle'
  | 'bath'
  | 'firstAid'
  | 'cribBox'
  | 'bassinetBox'
  | 'teddy'
  | 'shoes'
  | 'warmer'
  | 'mobileToy'
  | 'pillow'
  | 'bumper'
  | 'plush'
  | 'quilt'
  | 'sheet'
  | 'sleepSack';

interface ItemArt {
  readonly w: number;
  readonly h: number;
  draw(ctx: Ctx, w: number, h: number): void;
}

const ITEMS: Record<ItemArtKey, ItemArt> = {
  'diapers-s': { w: 40, h: 44, draw: (ctx) => diaperPack(ctx, 40, 44, '#9ED2C6', '24') },
  'diapers-m': { w: 48, h: 50, draw: (ctx) => diaperPack(ctx, 48, 50, '#F6C177', '40') },
  'diapers-l': { w: 58, h: 56, draw: (ctx) => diaperPack(ctx, 58, 56, '#7FB3D5', '60') },
  clothes: {
    w: 48,
    h: 44,
    draw(ctx) {
      ctx.beginPath();
      ctx.moveTo(14, 6);
      ctx.lineTo(4, 14);
      ctx.lineTo(9, 21);
      ctx.lineTo(14, 18);
      ctx.lineTo(14, 36);
      ctx.quadraticCurveTo(24, 42, 34, 36);
      ctx.lineTo(34, 18);
      ctx.lineTo(39, 21);
      ctx.lineTo(44, 14);
      ctx.lineTo(34, 6);
      ctx.quadraticCurveTo(24, 12, 14, 6);
      ctx.closePath();
      ctx.fillStyle = vGradient(ctx, 6, 40, '#FBE3EA', '#F2BFCD');
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      drawIcon(ctx, 'heart', 24, 24, 12);
    },
  },
  swaddle: {
    w: 48,
    h: 40,
    draw(ctx) {
      fillRound(ctx, 4, 8, 40, 26, 8, '#CDE8DA', OUT, 2);
      fillRound(ctx, 4, 8, 40, 10, 6, '#B6DCC8', OUT, 1.5);
      for (let i = 0; i < 4; i++) ellipse(ctx, 12 + i * 8, 26, 2, 2, '#FFFFFF');
    },
  },
  bath: {
    w: 52,
    h: 44,
    draw(ctx) {
      fillRound(ctx, 4, 18, 44, 22, 10, '#7FC8E8', OUT, 2);
      fillRound(ctx, 30, 2, 12, 20, 4, '#F2C14E', OUT, 2);
      for (let i = 0; i < 3; i++) ellipse(ctx, 14 + i * 7, 16 - i * 3, 3.5, 3.5, 'rgba(255,255,255,0.9)', OUT, 1);
    },
  },
  firstAid: {
    w: 46,
    h: 40,
    draw(ctx) {
      fillRound(ctx, 4, 8, 38, 28, 5, '#FFFFFF', OUT, 2);
      fillRound(ctx, 16, 2, 14, 8, 3, '#E9EEF0', OUT, 1.5);
      drawIcon(ctx, 'hospital', 23, 22, 22);
    },
  },
  cribBox: {
    w: 104,
    h: 84,
    draw(ctx, w, h) {
      fillRound(ctx, 4, 6, w - 8, h - 10, 4, vGradient(ctx, 6, h, '#D9A86C', '#B5814F'), OUT, 2.5);
      ctx.fillStyle = '#F2D6A8';
      ctx.fillRect(w / 2 - 6, 7, 12, h - 12);
      fillRound(ctx, 14, 20, 34, 30, 4, '#FFF8E7', OUT, 1.5);
      ctx.strokeStyle = '#B88456';
      ctx.lineWidth = 2;
      for (let x = 18; x < 46; x += 6) {
        ctx.beginPath();
        ctx.moveTo(x, 26);
        ctx.lineTo(x, 46);
        ctx.stroke();
      }
      drawIcon(ctx, 'baby', w - 28, 34, 22);
    },
  },
  bassinetBox: {
    w: 80,
    h: 68,
    draw(ctx, w, h) {
      fillRound(ctx, 4, 6, w - 8, h - 10, 4, vGradient(ctx, 6, h, '#E9C99A', '#C9A06A'), OUT, 2.5);
      ellipse(ctx, w / 2, h / 2 + 2, 22, 12, '#FFF8E7', OUT, 1.5);
      drawIcon(ctx, 'moon', w / 2, h / 2, 16);
    },
  },
  teddy: {
    w: 44,
    h: 48,
    draw(ctx) {
      for (const ex of [12, 32]) ellipse(ctx, ex, 10, 6, 6, '#B07F55', OUT, 2);
      ellipse(ctx, 22, 32, 14, 13, '#C8956A', OUT, 2);
      ellipse(ctx, 22, 16, 12, 11, '#C8956A', OUT, 2);
      ellipse(ctx, 22, 20, 5, 3.5, '#F1D9C0');
      ellipse(ctx, 18, 14, 1.5, 1.8, OUT);
      ellipse(ctx, 26, 14, 1.5, 1.8, OUT);
      fillRound(ctx, 15, 25, 14, 5, 2, '#E85D75');
    },
  },
  shoes: {
    w: 46,
    h: 34,
    draw(ctx) {
      for (const x of [4, 24]) {
        fillRound(ctx, x, 12, 18, 16, 7, '#F4A6A6', OUT, 2);
        ellipse(ctx, x + 9, 13, 5, 3, '#FFFFFF', OUT, 1);
        drawIcon(ctx, 'star', x + 9, 21, 9);
      }
    },
  },
  warmer: {
    w: 46,
    h: 40,
    draw(ctx) {
      fillRound(ctx, 4, 10, 38, 26, 6, '#E9EEF0', OUT, 2);
      ellipse(ctx, 34, 28, 3, 3, '#E85D5D');
      ctx.strokeStyle = '#F2994A';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(14 + i * 8, 8);
        ctx.quadraticCurveTo(18 + i * 8, 4, 14 + i * 8, 0);
        ctx.stroke();
      }
    },
  },
  mobileToy: {
    w: 48,
    h: 48,
    draw(ctx) {
      capsule(ctx, 24, 2, 24, 12, 2, OUT);
      capsule(ctx, 6, 14, 42, 14, 3, '#B07F55');
      for (const [x, c] of [[8, '#F4A6A6'], [24, '#9ED2C6'], [40, '#F6C177']] as const) {
        capsule(ctx, x, 14, x, 28, 1.5, OUT);
        drawIcon(ctx, 'star', x, 34, 14, OUT);
        ellipse(ctx, x, 34, 0.1, 0.1, c);
      }
    },
  },
  pillow: {
    w: 52,
    h: 36,
    draw(ctx) {
      fillRound(ctx, 4, 6, 44, 26, 12, vGradient(ctx, 6, 32, '#FFFFFF', '#E3E7EE'), OUT, 2);
      ctx.strokeStyle = 'rgba(150,160,180,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(14, 19);
      ctx.quadraticCurveTo(26, 14, 38, 19);
      ctx.stroke();
    },
  },
  bumper: {
    w: 60,
    h: 30,
    draw(ctx) {
      for (let i = 0; i < 4; i++) fillRound(ctx, 4 + i * 13, 6, 14, 20, 6, i % 2 ? '#F7D6E0' : '#FBE9EF', OUT, 1.6);
      capsule(ctx, 2, 4, 8, 8, 1.5, '#E85D75');
      capsule(ctx, 58, 4, 52, 8, 1.5, '#E85D75');
    },
  },
  plush: {
    w: 44,
    h: 44,
    draw(ctx) {
      ellipse(ctx, 22, 26, 15, 14, '#F6C177', OUT, 2);
      for (const ex of [12, 32]) ellipse(ctx, ex, 11, 5, 7, '#F6C177', OUT, 2);
      ellipse(ctx, 17, 23, 1.8, 2.2, OUT);
      ellipse(ctx, 27, 23, 1.8, 2.2, OUT);
      ellipse(ctx, 22, 30, 4, 2.5, '#E8735A');
    },
  },
  quilt: {
    w: 56,
    h: 40,
    draw(ctx) {
      fillRound(ctx, 4, 6, 48, 30, 10, vGradient(ctx, 6, 36, '#B5A3D8', '#8E79BF'), OUT, 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      for (let x = 14; x < 50; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x, 34);
        ctx.stroke();
      }
    },
  },
  sheet: {
    w: 52,
    h: 36,
    draw(ctx) {
      fillRound(ctx, 4, 8, 44, 22, 4, '#DDF0F5', OUT, 2);
      ctx.strokeStyle = 'rgba(120, 170, 190, 0.5)';
      for (let y = 12; y < 30; y += 5) {
        ctx.beginPath();
        ctx.moveTo(6, y);
        ctx.lineTo(46, y);
        ctx.stroke();
      }
    },
  },
  sleepSack: {
    w: 44,
    h: 48,
    draw(ctx) {
      ctx.beginPath();
      ctx.moveTo(14, 6);
      ctx.lineTo(30, 6);
      ctx.lineTo(36, 14);
      ctx.quadraticCurveTo(40, 40, 22, 44);
      ctx.quadraticCurveTo(4, 40, 8, 14);
      ctx.closePath();
      ctx.fillStyle = vGradient(ctx, 6, 44, '#BFE3D0', '#93CDB1');
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      capsule(ctx, 22, 10, 22, 34, 1.5, 'rgba(59,36,22,0.5)');
    },
  },
};

export const ITEM_ART_KEYS = Object.keys(ITEMS) as ItemArtKey[];

export function drawItem(key: ItemArtKey): HTMLCanvasElement {
  const art = ITEMS[key];
  const { canvas, ctx } = makeCanvas(art.w, art.h);
  ctx.lineJoin = 'round';
  art.draw(ctx, art.w, art.h);
  return canvas;
}

function diaperPack(ctx: Ctx, w: number, h: number, color: string, label: string): void {
  fillRound(ctx, 3, 5, w - 6, h - 8, 7, vGradient(ctx, 5, h, shade(color, 0.25), shade(color, -0.1)), OUT, 2);
  fillRound(ctx, 3, 5, w - 6, 8, 5, shade(color, -0.2), OUT, 1.5);
  ellipse(ctx, w / 2, h / 2 + 2, w / 5, w / 5, '#FFFFFF', OUT, 1.2);
  drawIcon(ctx, 'baby', w / 2, h / 2 + 2, w / 2.6);
  fillRound(ctx, w - 22, h - 15, 18, 11, 3, '#FFFFFF', OUT, 1.2);
  ctx.fillStyle = OUT;
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w - 13, h - 9.5);
}

// ---------------------------------------------------------------------------------------------
// HUD shapes

export function drawJoystickBase(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(180, 180);
  const g = ctx.createRadialGradient(90, 90, 20, 90, 90, 88);
  g.addColorStop(0, 'rgba(255, 248, 235, 0.18)');
  g.addColorStop(1, 'rgba(255, 248, 235, 0.42)');
  ellipse(ctx, 90, 90, 84, 84, g, 'rgba(59, 36, 22, 0.45)', 4);
  ctx.fillStyle = 'rgba(59, 36, 22, 0.4)';
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate(90, 90);
    ctx.rotate((i * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(0, -74);
    ctx.lineTo(9, -62);
    ctx.lineTo(-9, -62);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  return canvas;
}

export function drawJoystickKnob(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(84, 84);
  const g = ctx.createRadialGradient(36, 34, 4, 42, 42, 40);
  g.addColorStop(0, '#FFF8EC');
  g.addColorStop(1, '#F2C9A0');
  ellipse(ctx, 42, 42, 36, 36, g, '#3B2416', 3);
  return canvas;
}

export function drawRoundButton(icon: IconName, fill: string, size = 120): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size, size);
  const r = size / 2 - 6;
  ellipse(ctx, size / 2, size / 2 + 4, r, r, 'rgba(59, 36, 22, 0.35)');
  const g = ctx.createRadialGradient(size / 2 - r / 3, size / 2 - r / 3, 4, size / 2, size / 2, r);
  g.addColorStop(0, shade(fill, 0.35));
  g.addColorStop(1, fill);
  ellipse(ctx, size / 2, size / 2, r, r, g, '#3B2416', 3.5);
  drawIcon(ctx, icon, size / 2, size / 2, size * 0.42, '#3B2416');
  return canvas;
}

export function drawChevron(color: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(32, 28);
  ctx.beginPath();
  ctx.moveTo(4, 6);
  ctx.lineTo(16, 22);
  ctx.lineTo(28, 6);
  ctx.lineTo(16, 12);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#3B2416';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  return canvas;
}

export function drawStarTexture(size = 48, fill = '#F2C14E'): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size, size);
  star(ctx, size / 2, size / 2, size / 2 - 3, fill, '#3B2416');
  return canvas;
}

export function drawSparkle(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(24, 24);
  const g = ctx.createRadialGradient(12, 12, 0, 12, 12, 12);
  g.addColorStop(0, 'rgba(255, 255, 240, 1)');
  g.addColorStop(0.3, 'rgba(255, 230, 150, 0.8)');
  g.addColorStop(1, 'rgba(255, 220, 120, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 24, 24);
  return canvas;
}

export function drawConfetti(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(10, 14);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 10, 14);
  return canvas;
}

export function drawGlow(size = 256, color = '255, 214, 150'): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${color}, 0.55)`);
  g.addColorStop(0.5, `rgba(${color}, 0.18)`);
  g.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

export function drawRing(color: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(96, 48);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 7]);
  ctx.beginPath();
  ctx.ellipse(48, 24, 44, 20, 0, 0, Math.PI * 2);
  ctx.stroke();
  return canvas;
}
