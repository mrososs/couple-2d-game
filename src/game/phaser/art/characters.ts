import type { CharacterId } from '../../bridge/protocol.ts';
import { capsule, contactShadow, ellipse, fillRound, makeCanvas, roundRect, shade, type Ctx } from './canvas-kit.ts';

/**
 * The two cartoon characters, drawn pose by pose into one sprite sheet each. Chibi proportions -
 * a big head, expressive eyes, short limbs - so they read at phone size, with silhouettes that
 * differ at a glance: her hijab and long tunic, his curly hair and broader shirt.
 */

export const FRAME_W = 64;
export const FRAME_H = 96;
/** Where the feet touch the floor inside a frame; sprites use it as their origin. */
export const FOOT_Y = 90;

export type FacingDir = 'down' | 'up' | 'side';
type Arms = 'rest' | 'swing' | 'carry' | 'reach' | 'cheer' | 'droop';
type Face = 'neutral' | 'happy' | 'tired' | 'joy' | 'blink';

interface Pose {
  readonly dir: FacingDir;
  /** -1..1, the walk cycle's leg phase. */
  readonly step: number;
  /** Pixels the body rises (breathing, bounce). */
  readonly bob: number;
  readonly arms: Arms;
  readonly face: Face;
  /** 0..1, how far an interacting arm reaches. */
  readonly reach?: number;
}

export interface Outfit {
  readonly label: string;
  readonly top: string;
  readonly bottom: string;
  readonly accent: string;
  readonly shoes: string;
}

export const OUTFITS: Readonly<Record<CharacterId, readonly Outfit[]>> = {
  wife: [
    { label: 'مرجاني', top: '#E8735A', bottom: '#3E4C6E', accent: '#2A9D8F', shoes: '#5B3A29' },
    { label: 'بنفسجي', top: '#8E6BBF', bottom: '#40384F', accent: '#F2C14E', shoes: '#4A2F3A' },
    { label: 'أزرق', top: '#3C88B5', bottom: '#4A3F35', accent: '#F28C6B', shoes: '#3B2A22' },
  ],
  husband: [
    { label: 'أزرق', top: '#3E7CB1', bottom: '#33415C', accent: '#F4D35E', shoes: '#3B2A22' },
    { label: 'زيتوني', top: '#7BA05B', bottom: '#4B3B2F', accent: '#E9C46A', shoes: '#2E2420' },
    { label: 'خردلي', top: '#E2A33B', bottom: '#2F3E46', accent: '#3E7CB1', shoes: '#3B2A22' },
  ],
};

const OUTLINE = '#3B2416';
const SKIN = { wife: '#D9A07A', husband: '#C98B62' } as const;
const HAIR = '#2A1C14';
const EYE = '#2B1B12';

/** Every frame of a sheet, by name, in the order they are laid out. */
export function frameList(): { name: string; pose: Pose }[] {
  const frames: { name: string; pose: Pose }[] = [];
  const dirs: FacingDir[] = ['down', 'up', 'side'];
  const cycle = [1, 0, -1, 0];
  for (const dir of dirs) {
    frames.push({ name: `idle-${dir}-0`, pose: { dir, step: 0, bob: 0, arms: 'rest', face: 'neutral' } });
    frames.push({ name: `idle-${dir}-1`, pose: { dir, step: 0, bob: 1, arms: 'rest', face: 'neutral' } });
    frames.push({ name: `idle-${dir}-2`, pose: { dir, step: 0, bob: 0, arms: 'rest', face: 'blink' } });
    cycle.forEach((step, i) =>
      frames.push({ name: `walk-${dir}-${i}`, pose: { dir, step, bob: i % 2 ? 2 : 0, arms: 'swing', face: 'neutral' } }),
    );
    frames.push({ name: `carry-idle-${dir}-0`, pose: { dir, step: 0, bob: 0, arms: 'carry', face: 'neutral' } });
    frames.push({ name: `carry-idle-${dir}-1`, pose: { dir, step: 0, bob: 1, arms: 'carry', face: 'neutral' } });
    cycle.forEach((step, i) =>
      frames.push({ name: `carry-walk-${dir}-${i}`, pose: { dir, step, bob: i % 2 ? 2 : 0, arms: 'carry', face: 'neutral' } }),
    );
    frames.push({ name: `interact-${dir}-0`, pose: { dir, step: 0, bob: 0, arms: 'reach', face: 'neutral', reach: 0.5 } });
    frames.push({ name: `interact-${dir}-1`, pose: { dir, step: 0, bob: 1, arms: 'reach', face: 'happy', reach: 1 } });
  }
  frames.push({ name: 'happy-0', pose: { dir: 'down', step: 0, bob: 0, arms: 'rest', face: 'happy' } });
  frames.push({ name: 'happy-1', pose: { dir: 'down', step: 0, bob: 3, arms: 'swing', face: 'joy' } });
  frames.push({ name: 'tired-0', pose: { dir: 'down', step: 0, bob: -1, arms: 'droop', face: 'tired' } });
  frames.push({ name: 'tired-1', pose: { dir: 'down', step: 0, bob: 0, arms: 'droop', face: 'tired' } });
  frames.push({ name: 'cheer-0', pose: { dir: 'down', step: 0, bob: 0, arms: 'cheer', face: 'joy' } });
  frames.push({ name: 'cheer-1', pose: { dir: 'down', step: 0.4, bob: 5, arms: 'cheer', face: 'joy' } });
  return frames;
}

export const SHEET_COLUMNS = 10;

/** Draws a character's whole sheet. Frame `i` is at column `i % SHEET_COLUMNS`, row `floor(i / SHEET_COLUMNS)`. */
export function drawCharacterSheet(id: CharacterId, outfit: Outfit): { canvas: HTMLCanvasElement; frames: string[] } {
  const frames = frameList();
  const rows = Math.ceil(frames.length / SHEET_COLUMNS);
  const { canvas, ctx } = makeCanvas(SHEET_COLUMNS * FRAME_W, rows * FRAME_H);
  frames.forEach((frame, i) => {
    ctx.save();
    ctx.translate((i % SHEET_COLUMNS) * FRAME_W, Math.floor(i / SHEET_COLUMNS) * FRAME_H);
    drawCharacter(ctx, id, outfit, frame.pose);
    ctx.restore();
  });
  return { canvas, frames: frames.map((f) => f.name) };
}

/** A larger, standalone portrait for menus and the swap button. */
export function drawPortrait(id: CharacterId, outfit: Outfit, size: number, face: Face = 'happy'): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size, size);
  const scale = size / 60;
  ctx.scale(scale, scale);
  ctx.translate(-2, -4);
  drawCharacter(ctx, id, outfit, { dir: 'down', step: 0, bob: 0, arms: 'rest', face });
  return canvas;
}

export function drawShadowTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(48, 18);
  contactShadow(ctx, 24, 9, 22, 8, 0.32);
  return canvas;
}

export function drawCharacter(ctx: Ctx, id: CharacterId, outfit: Outfit, pose: Pose): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (pose.dir === 'side') drawSide(ctx, id, outfit, pose);
  else drawFrontOrBack(ctx, id, outfit, pose);
}

// ---------------------------------------------------------------------------------------------
// Front and back

function drawFrontOrBack(ctx: Ctx, id: CharacterId, o: Outfit, p: Pose): void {
  const cx = 32;
  const back = p.dir === 'up';
  const wife = id === 'wife';
  const skin = SKIN[id];
  const lift = (phase: number) => Math.max(0, phase) * 3;
  const hipY = wife ? 72 : 67;
  const up = -p.bob;

  // Legs, then shoes. In the walk cycle the lifted leg rises and steps a little inward.
  const legW = wife ? 7 : 8;
  for (const side of [-1, 1] as const) {
    const l = lift(side === -1 ? p.step : -p.step);
    const x = cx + side * (wife ? 5.5 : 6);
    capsule(ctx, x, hipY + up, x, 84 - l, legW, o.bottom, OUTLINE);
    ellipse(ctx, x + side * 1, 86 - l, 5.5, 3.6, o.shoes, OUTLINE, 1.5);
  }

  // Arms behind the body when walking away; in front otherwise.
  const shoulderY = (wife ? 50 : 48) + up;
  const shoulderX = wife ? 11 : 13.5;
  const drawArms = () => drawFrontArms(ctx, id, o, p, cx, shoulderX, shoulderY, skin, back);
  if (back) drawArms();

  // Torso.
  if (wife) {
    ctx.beginPath();
    ctx.moveTo(cx - 11, 45 + up);
    ctx.quadraticCurveTo(cx - 13, 60 + up, cx - 16, 75 + up);
    ctx.quadraticCurveTo(cx, 78 + up, cx + 16, 75 + up);
    ctx.quadraticCurveTo(cx + 13, 60 + up, cx + 11, 45 + up);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - 16, 0, cx + 16, 0);
    g.addColorStop(0, shade(o.top, 0.12));
    g.addColorStop(1, shade(o.top, -0.12));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // Embroidered band near the hem.
    ctx.strokeStyle = o.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 14.5, 70 + up);
    ctx.quadraticCurveTo(cx, 73 + up, cx + 14.5, 70 + up);
    ctx.stroke();
    if (!back) {
      ctx.fillStyle = shade(o.accent, 0.2);
      for (let i = -2; i <= 2; i++) ellipse(ctx, cx + i * 5.5, 71.5 + up + Math.abs(i) * -0.6, 1.2, 1.2, '#FFF6E0');
    }
  } else {
    fillRound(ctx, cx - 14, 44 + up, 28, 26, 9, verticalShade(ctx, o.top, 44 + up, 70 + up), OUTLINE);
    if (!back) {
      // Collar and a pocket.
      ctx.strokeStyle = shade(o.top, -0.35);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 5, 45 + up);
      ctx.lineTo(cx, 51 + up);
      ctx.lineTo(cx + 5, 45 + up);
      ctx.stroke();
      fillRound(ctx, cx + 3, 55 + up, 7, 6, 2, shade(o.top, -0.1), shade(o.top, -0.35), 1.2);
    }
    // Belt line.
    ctx.fillStyle = shade(o.bottom, -0.2);
    ctx.fillRect(cx - 13, 66 + up, 26, 3);
  }

  if (!back) drawArms();

  // Head.
  const headY = (wife ? 30 : 28) + up + (p.arms === 'droop' ? 2 : 0);
  if (wife) drawWifeHead(ctx, o, cx, headY, back, p.face, skin);
  else drawHusbandHead(ctx, cx, headY, back, p.face, skin);
}

function drawFrontArms(ctx: Ctx, id: CharacterId, o: Outfit, p: Pose, cx: number, sx: number, sy: number, skin: string, back: boolean): void {
  const len = id === 'wife' ? 16 : 17;
  for (const side of [-1, 1] as const) {
    const shoulder = { x: cx + side * sx, y: sy };
    let hand: { x: number; y: number };
    switch (p.arms) {
      case 'carry':
        hand = { x: cx + side * 12, y: sy - 34 };
        break;
      case 'cheer':
        hand = { x: cx + side * 22, y: sy - 30 };
        break;
      case 'reach': {
        const r = p.reach ?? 1;
        hand = side === 1 ? { x: shoulder.x + 6 + 6 * r, y: shoulder.y + 8 - (back ? 10 : 0) * r } : { x: shoulder.x - 2, y: shoulder.y + len };
        break;
      }
      case 'droop':
        hand = { x: shoulder.x + side * 1, y: shoulder.y + len + 2 };
        break;
      case 'swing': {
        const swing = (side === -1 ? -p.step : p.step) * 5;
        hand = { x: shoulder.x + side * 3, y: shoulder.y + len - Math.abs(swing) * 0.3 + swing * (back ? -0.4 : 0.4) };
        break;
      }
      default:
        hand = { x: shoulder.x + side * 3, y: shoulder.y + len };
    }
    const sleeveEnd = id === 'wife' ? hand : lerp(shoulder, hand, 0.45);
    capsule(ctx, shoulder.x, shoulder.y, sleeveEnd.x, sleeveEnd.y, id === 'wife' ? 7 : 8, o.top, OUTLINE);
    if (id === 'husband') capsule(ctx, sleeveEnd.x, sleeveEnd.y, hand.x, hand.y, 6, skin, OUTLINE);
    ellipse(ctx, hand.x, hand.y, 4, 4, skin, OUTLINE, 1.5);
  }
}

function drawWifeHead(ctx: Ctx, o: Outfit, cx: number, cy: number, back: boolean, face: Face, skin: string): void {
  const scarf = o.accent;
  // The hijab's drape over the shoulders, then its crown.
  ctx.beginPath();
  ctx.moveTo(cx - 15, cy + 4);
  ctx.quadraticCurveTo(cx - 19, cy + 18, cx - 14, cy + 23);
  ctx.quadraticCurveTo(cx, cy + 27, cx + 14, cy + 23);
  ctx.quadraticCurveTo(cx + 19, cy + 18, cx + 15, cy + 4);
  ctx.closePath();
  ctx.fillStyle = shade(scarf, -0.1);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
  ellipse(ctx, cx, cy - 1, 18.5, 18, verticalShade(ctx, scarf, cy - 19, cy + 17), OUTLINE);
  if (back) {
    // Folds gathered at the back.
    ctx.strokeStyle = shade(scarf, -0.3);
    ctx.lineWidth = 1.5;
    for (const dx of [-6, 0, 6]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * 0.6, cy - 6);
      ctx.quadraticCurveTo(cx + dx, cy + 8, cx + dx * 1.3, cy + 22);
      ctx.stroke();
    }
    return;
  }
  // The face, framed by the scarf.
  ellipse(ctx, cx, cy + 2, 12.5, 13.5, skin, OUTLINE, 1.5);
  // A soft fold where the scarf meets the forehead.
  ctx.strokeStyle = shade(scarf, 0.25);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy + 2, 13.8, Math.PI * 1.12, Math.PI * 1.88);
  ctx.stroke();
  ellipse(ctx, cx + 13, cy + 12, 2.2, 2.2, '#FFF3D6', OUTLINE, 1);
  drawFace(ctx, cx, cy + 3, face, true);
}

function drawHusbandHead(ctx: Ctx, cx: number, cy: number, back: boolean, face: Face, skin: string): void {
  // Neck and ears.
  fillRound(ctx, cx - 5, cy + 12, 10, 8, 3, shade(skin, -0.12), OUTLINE, 1.5);
  ellipse(ctx, cx - 16.5, cy + 2, 3.5, 4.5, skin, OUTLINE, 1.5);
  ellipse(ctx, cx + 16.5, cy + 2, 3.5, 4.5, skin, OUTLINE, 1.5);
  ellipse(ctx, cx, cy, 16.5, 17, skin, OUTLINE);
  if (back) {
    // Curly hair covers the back of the head.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, 16.5, 17, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = HAIR;
    ctx.fillRect(cx - 20, cy - 20, 40, 30);
    ctx.restore();
    curls(ctx, cx, cy - 12, 15, 9);
    return;
  }
  // Short beard along the jaw.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, 16.5, 17, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(42, 28, 20, 0.55)';
  ctx.beginPath();
  ctx.moveTo(cx - 17, cy + 1);
  ctx.quadraticCurveTo(cx - 14, cy + 19, cx, cy + 19);
  ctx.quadraticCurveTo(cx + 14, cy + 19, cx + 17, cy + 1);
  ctx.lineTo(cx + 13, cy + 3);
  ctx.quadraticCurveTo(cx + 9, cy + 13, cx, cy + 13);
  ctx.quadraticCurveTo(cx - 9, cy + 13, cx - 13, cy + 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Hair on top.
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(cx - 17, cy - 1);
  ctx.quadraticCurveTo(cx - 18, cy - 18, cx, cy - 19);
  ctx.quadraticCurveTo(cx + 18, cy - 18, cx + 17, cy - 1);
  ctx.quadraticCurveTo(cx + 12, cy - 9, cx + 4, cy - 9);
  ctx.quadraticCurveTo(cx - 6, cy - 10, cx - 17, cy - 1);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
  curls(ctx, cx, cy - 13, 14, 6);
  drawFace(ctx, cx, cy + 1, face, false);
}

function curls(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.strokeStyle = '#4A3326';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    const x = cx + Math.cos(a) * rx * 0.8;
    const y = cy + Math.sin(a) * ry * 0.8 + 3;
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 1.4);
    ctx.stroke();
  }
}

function drawFace(ctx: Ctx, cx: number, cy: number, face: Face, wife: boolean): void {
  const eyeY = cy - 1;
  const dx = 5.5;
  // Blush.
  ellipse(ctx, cx - 9, cy + 5, 3.2, 2, 'rgba(232, 100, 90, 0.35)');
  ellipse(ctx, cx + 9, cy + 5, 3.2, 2, 'rgba(232, 100, 90, 0.35)');
  // Brows.
  ctx.strokeStyle = wife ? '#3A2418' : HAIR;
  ctx.lineWidth = wife ? 1.6 : 2.4;
  for (const side of [-1, 1]) {
    // Soft arches, lifted in the middle: friendly at rest, drooping at the outer ends when tired.
    const droop = face === 'tired' ? 2 : 0;
    ctx.beginPath();
    ctx.moveTo(cx + side * (dx - 3.5), eyeY - 6);
    ctx.quadraticCurveTo(cx + side * dx, eyeY - 9 + droop * 0.5, cx + side * (dx + 3.5), eyeY - 6.5 + droop);
    ctx.stroke();
  }
  // Eyes.
  for (const side of [-1, 1]) {
    const ex = cx + side * dx;
    if (face === 'blink' || face === 'joy') {
      ctx.strokeStyle = EYE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (face === 'joy') ctx.arc(ex, eyeY + 1.5, 3, Math.PI * 1.1, Math.PI * 1.9);
      else {
        ctx.moveTo(ex - 3, eyeY + 0.5);
        ctx.lineTo(ex + 3, eyeY + 0.5);
      }
      ctx.stroke();
    } else if (face === 'tired') {
      ellipse(ctx, ex, eyeY + 0.5, 3, 2.4, EYE);
      ctx.fillStyle = shade(SKIN.wife, -0.05);
      ctx.fillRect(ex - 3.5, eyeY - 3, 7, 2.6);
    } else {
      ellipse(ctx, ex, eyeY, 3.4, 4.2, EYE);
      ellipse(ctx, ex + 1, eyeY - 1.6, 1.3, 1.3, '#FFFFFF');
      ellipse(ctx, ex - 1, eyeY + 1.6, 0.7, 0.7, 'rgba(255,255,255,0.8)');
    }
  }
  if (wife && face !== 'blink' && face !== 'joy') {
    // Lashes.
    ctx.strokeStyle = EYE;
    ctx.lineWidth = 1.2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * (dx + 3), eyeY - 2);
      ctx.lineTo(cx + side * (dx + 4.6), eyeY - 3.4);
      ctx.stroke();
    }
  }
  // Mouth.
  const my = cy + 7;
  ctx.strokeStyle = '#6B2E22';
  ctx.lineWidth = 1.8;
  switch (face) {
    case 'happy':
    case 'joy':
      ctx.beginPath();
      ctx.moveTo(cx - 4.5, my - 1);
      ctx.quadraticCurveTo(cx, my + 6, cx + 4.5, my - 1);
      ctx.closePath();
      ctx.fillStyle = '#8C2F25';
      ctx.fill();
      ctx.stroke();
      ellipse(ctx, cx, my + 2.4, 2, 1.1, '#E5736A');
      break;
    case 'tired':
      ctx.beginPath();
      ctx.moveTo(cx - 3, my + 1);
      ctx.quadraticCurveTo(cx, my - 0.5, cx + 3, my + 1);
      ctx.stroke();
      // A sweat drop.
      ctx.fillStyle = '#7CC6F2';
      ctx.beginPath();
      ctx.moveTo(cx + 14, cy - 8);
      ctx.quadraticCurveTo(cx + 18, cy - 2, cx + 14, cy);
      ctx.quadraticCurveTo(cx + 10, cy - 2, cx + 14, cy - 8);
      ctx.fill();
      break;
    default:
      ctx.beginPath();
      ctx.arc(cx, my - 2, 3.4, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
  }
}

// ---------------------------------------------------------------------------------------------
// Side (facing left; the game flips it for right)

function drawSide(ctx: Ctx, id: CharacterId, o: Outfit, p: Pose): void {
  const cx = 32;
  const wife = id === 'wife';
  const skin = SKIN[id];
  const up = -p.bob;
  const hipY = wife ? 72 : 67;
  const stride = p.step * 6;

  // Far leg (darker), then near leg.
  const legs: [number, string][] = [
    [cx + 1 - stride, shade(o.bottom, -0.25)],
    [cx - 1 + stride, o.bottom],
  ];
  for (const [x, color] of legs) {
    capsule(ctx, cx, hipY + up, x, 85, wife ? 7 : 8, color, OUTLINE);
    ellipse(ctx, x - 2.5, 86.5, 6, 3.4, o.shoes, OUTLINE, 1.5);
  }

  const shoulder = { x: cx + 1, y: (wife ? 50 : 48) + up };
  const farHand = armHand(p, shoulder, true);
  capsule(ctx, shoulder.x + 2, shoulder.y, farHand.x + 2, farHand.y, wife ? 6 : 7, shade(o.top, -0.25), OUTLINE);

  if (wife) {
    ctx.beginPath();
    ctx.moveTo(cx - 8, 45 + up);
    // The baby bump: a gentle curve forward at the belly.
    ctx.quadraticCurveTo(cx - 17, 58 + up, cx - 14, 75 + up);
    ctx.quadraticCurveTo(cx, 78 + up, cx + 13, 75 + up);
    ctx.quadraticCurveTo(cx + 10, 58 + up, cx + 8, 45 + up);
    ctx.closePath();
    ctx.fillStyle = verticalShade(ctx, o.top, 45 + up, 76 + up);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = o.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 13, 70 + up);
    ctx.quadraticCurveTo(cx, 73 + up, cx + 12, 70 + up);
    ctx.stroke();
  } else {
    fillRound(ctx, cx - 10, 44 + up, 21, 26, 8, verticalShade(ctx, o.top, 44 + up, 70 + up), OUTLINE);
    ctx.fillStyle = shade(o.bottom, -0.2);
    ctx.fillRect(cx - 9, 66 + up, 19, 3);
  }

  const nearHand = armHand(p, shoulder, false);
  if (wife) {
    capsule(ctx, shoulder.x, shoulder.y, nearHand.x, nearHand.y, 7, o.top, OUTLINE);
  } else {
    const elbow = lerp(shoulder, nearHand, 0.45);
    capsule(ctx, shoulder.x, shoulder.y, elbow.x, elbow.y, 8, o.top, OUTLINE);
    capsule(ctx, elbow.x, elbow.y, nearHand.x, nearHand.y, 6, skin, OUTLINE);
  }
  ellipse(ctx, nearHand.x, nearHand.y, 4, 4, skin, OUTLINE, 1.5);

  const headY = (wife ? 30 : 28) + up + (p.arms === 'droop' ? 2 : 0);
  if (wife) {
    ctx.beginPath();
    ctx.moveTo(cx - 2, headY + 6);
    ctx.quadraticCurveTo(cx + 18, headY + 12, cx + 12, headY + 24);
    ctx.quadraticCurveTo(cx, headY + 26, cx - 9, headY + 20);
    ctx.closePath();
    ctx.fillStyle = shade(o.accent, -0.12);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ellipse(ctx, cx + 1, headY - 1, 18, 18, verticalShade(ctx, o.accent, headY - 19, headY + 17), OUTLINE);
    // Face opening towards the left.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx + 1, headY - 1, 18, 18, 0, 0, Math.PI * 2);
    ctx.clip();
    ellipse(ctx, cx - 9, headY + 3, 11, 13, skin, OUTLINE, 1.5);
    ctx.restore();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx + 1, headY - 1, 18, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
    drawSideFace(ctx, cx - 9, headY + 3, p.face, true, skin);
  } else {
    fillRound(ctx, cx - 3, headY + 12, 9, 8, 3, shade(skin, -0.12), OUTLINE, 1.5);
    ellipse(ctx, cx, headY, 16.5, 17, skin, OUTLINE);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, headY, 16.5, 17, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = HAIR;
    ctx.beginPath();
    ctx.moveTo(cx - 18, headY - 6);
    ctx.quadraticCurveTo(cx - 6, headY - 22, cx + 18, headY - 12);
    ctx.lineTo(cx + 18, headY + 10);
    ctx.quadraticCurveTo(cx + 8, headY + 6, cx + 4, headY - 6);
    ctx.quadraticCurveTo(cx - 6, headY - 9, cx - 18, headY - 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(42, 28, 20, 0.55)';
    ctx.beginPath();
    ctx.moveTo(cx + 2, headY + 4);
    ctx.quadraticCurveTo(cx - 2, headY + 17, cx - 14, headY + 13);
    ctx.lineTo(cx - 12, headY + 9);
    ctx.quadraticCurveTo(cx - 3, headY + 11, cx, headY + 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, headY, 16.5, 17, 0, 0, Math.PI * 2);
    ctx.stroke();
    curls(ctx, cx + 2, headY - 12, 13, 6);
    ellipse(ctx, cx + 4, headY + 2, 3.5, 4.5, skin, OUTLINE, 1.5);
    drawSideFace(ctx, cx - 7, headY + 1, p.face, false, skin);
  }
}

function armHand(p: Pose, shoulder: { x: number; y: number }, far: boolean): { x: number; y: number } {
  switch (p.arms) {
    case 'carry':
      return { x: shoulder.x - 6 + (far ? 4 : 0), y: shoulder.y - 34 };
    case 'cheer':
      return { x: shoulder.x - 8 + (far ? 12 : 0), y: shoulder.y - 30 };
    case 'reach':
      return far ? { x: shoulder.x, y: shoulder.y + 16 } : { x: shoulder.x - 10 - 6 * (p.reach ?? 1), y: shoulder.y + 6 };
    case 'droop':
      return { x: shoulder.x - 1, y: shoulder.y + 18 };
    case 'swing': {
      const s = (far ? -p.step : p.step) * 7;
      return { x: shoulder.x - s, y: shoulder.y + 16 - Math.abs(s) * 0.2 };
    }
    default:
      return { x: shoulder.x, y: shoulder.y + 16 };
  }
}

function drawSideFace(ctx: Ctx, fx: number, fy: number, face: Face, wife: boolean, skin: string): void {
  // Nose.
  ctx.fillStyle = skin;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(fx - 9, fy - 1);
  ctx.quadraticCurveTo(fx - 14, fy + 3, fx - 9.5, fy + 4.5);
  ctx.stroke();
  ellipse(ctx, fx - 2, fy + 5, 3, 1.8, 'rgba(232, 100, 90, 0.35)');
  const ex = fx - 4;
  const ey = fy - 2;
  if (face === 'blink' || face === 'joy') {
    ctx.strokeStyle = EYE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ex, ey + 1.5, 2.6, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  } else {
    ellipse(ctx, ex, ey, 2.6, 3.8, EYE);
    ellipse(ctx, ex - 0.6, ey - 1.5, 1, 1, '#FFFFFF');
  }
  ctx.strokeStyle = wife ? '#3A2418' : HAIR;
  ctx.lineWidth = wife ? 1.6 : 2.3;
  ctx.beginPath();
  ctx.moveTo(ex - 3, ey - 6);
  ctx.lineTo(ex + 3, ey - 6.4);
  ctx.stroke();
  ctx.strokeStyle = '#6B2E22';
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  if (face === 'happy' || face === 'joy') {
    ctx.moveTo(fx - 8, fy + 7);
    ctx.quadraticCurveTo(fx - 5, fy + 10, fx - 2, fy + 7.5);
  } else {
    ctx.moveTo(fx - 8, fy + 8);
    ctx.lineTo(fx - 4, fy + 8);
  }
  ctx.stroke();
}

function verticalShade(ctx: Ctx, color: string, y0: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, shade(color, 0.15));
  g.addColorStop(1, shade(color, -0.15));
  return g;
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export { roundRect };
