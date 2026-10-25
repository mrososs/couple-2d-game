import { capsule, contactShadow, ellipse, fillRound, makeCanvas, roundRect, shade, vGradient, type Ctx } from './canvas-kit.ts';

/**
 * Furniture and fixtures, drawn in the same three-quarter view as the characters: the top surface
 * above, the front below, a dark warm outline and a soft contact shadow. Each prop says where its
 * solid footprint is, so collisions match what the eye sees.
 */

export interface PropArt {
  readonly w: number;
  readonly h: number;
  /** The solid part, measured up from the bottom edge and centred: null walks straight through. */
  readonly body: { readonly w: number; readonly h: number } | null;
  /** Hangs on a wall face rather than standing on the floor. */
  readonly wall?: boolean;
  /** Lies flat under everything (rugs). */
  readonly flat?: boolean;
  draw(ctx: Ctx, w: number, h: number): void;
}

const OUT = '#3B2416';

function block(ctx: Ctx, x: number, y: number, w: number, top: number, front: number, color: string, r = 6): void {
  fillRound(ctx, x, y + top - 2, w, front + 2, r, vGradient(ctx, y + top, y + top + front, shade(color, -0.05), shade(color, -0.25)), OUT);
  fillRound(ctx, x, y, w, top, r, vGradient(ctx, y, y + top, shade(color, 0.22), shade(color, 0.05)), OUT);
}

function knob(ctx: Ctx, x: number, y: number): void {
  ellipse(ctx, x, y, 2.4, 2.4, '#E9C46A', OUT, 1);
}

function shadowUnder(ctx: Ctx, w: number, h: number, inset = 6): void {
  contactShadow(ctx, w / 2, h - 6, w / 2 - inset, 9, 0.3);
}

export const PROPS: Record<string, PropArt> = {
  // ----------------------------------------------------------------------------- living room
  sofa: {
    w: 168,
    h: 104,
    body: { w: 160, h: 46 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h);
      // Carved, gilded wooden frame: the classic Egyptian salon set.
      fillRound(ctx, 6, 8, w - 12, 56, 26, vGradient(ctx, 8, 64, '#C9A04A', '#9C7430'), OUT, 2.5);
      for (let i = 0; i < 5; i++) ellipse(ctx, 26 + i * 29, 16, 5, 3, '#E8C766', OUT, 1);
      // Back cushion.
      fillRound(ctx, 16, 18, w - 32, 40, 14, vGradient(ctx, 18, 58, '#B5414A', '#8A2C36'), OUT);
      ctx.strokeStyle = '#E3B5A0';
      ctx.lineWidth = 1.5;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(16 + i * ((w - 32) / 4), 22);
        ctx.lineTo(16 + i * ((w - 32) / 4), 54);
        ctx.stroke();
      }
      // Seat.
      fillRound(ctx, 12, 52, w - 24, 34, 10, vGradient(ctx, 52, 86, '#C24D55', '#8E2F38'), OUT);
      // Arms.
      fillRound(ctx, 2, 40, 22, 52, 10, vGradient(ctx, 40, 92, '#D2AA52', '#9A7230'), OUT);
      fillRound(ctx, w - 24, 40, 22, 52, 10, vGradient(ctx, 40, 92, '#D2AA52', '#9A7230'), OUT);
      // Legs.
      for (const lx of [16, w - 22]) fillRound(ctx, lx, 86, 6, 12, 2, '#7A5520', OUT, 1.5);
      // Throw pillows.
      fillRound(ctx, 30, 40, 26, 22, 8, '#F2C14E', OUT);
      fillRound(ctx, w - 56, 40, 26, 22, 8, '#2A9D8F', OUT);
    },
  },
  armchair: {
    w: 72,
    h: 92,
    body: { w: 64, h: 40 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h);
      fillRound(ctx, 6, 6, w - 12, 50, 20, vGradient(ctx, 6, 56, '#C9A04A', '#9C7430'), OUT, 2.5);
      fillRound(ctx, 13, 14, w - 26, 38, 12, vGradient(ctx, 14, 52, '#B5414A', '#8A2C36'), OUT);
      fillRound(ctx, 10, 46, w - 20, 28, 9, vGradient(ctx, 46, 74, '#C24D55', '#8E2F38'), OUT);
      fillRound(ctx, 2, 38, 14, 42, 7, '#C29B48', OUT);
      fillRound(ctx, w - 16, 38, 14, 42, 7, '#C29B48', OUT);
      for (const lx of [12, w - 18]) fillRound(ctx, lx, 76, 6, 10, 2, '#7A5520', OUT, 1.5);
    },
  },
  sofaBack: {
    w: 176,
    h: 86,
    body: { w: 166, h: 44 },
    draw(ctx, w, h) {
      // The salon sofa seen from behind, facing the TV across the coffee table.
      shadowUnder(ctx, w, h);
      fillRound(ctx, 4, 18, w - 8, 58, 22, vGradient(ctx, 18, 76, '#B58B3E', '#8A6228'), OUT, 2.5);
      fillRound(ctx, 14, 6, w - 28, 50, 18, vGradient(ctx, 6, 56, '#C9A04A', '#9C7430'), OUT, 2.5);
      for (let i = 0; i < 5; i++) ellipse(ctx, 30 + i * 29, 12, 5, 3, '#E8C766', OUT, 1);
      fillRound(ctx, 26, 20, w - 52, 30, 10, vGradient(ctx, 20, 50, '#A23A43', '#7E2833'), OUT, 1.5);
      fillRound(ctx, 0, 30, 22, 44, 10, vGradient(ctx, 30, 74, '#D2AA52', '#9A7230'), OUT);
      fillRound(ctx, w - 22, 30, 22, 44, 10, vGradient(ctx, 30, 74, '#D2AA52', '#9A7230'), OUT);
      for (const lx of [18, w - 24]) fillRound(ctx, lx, 72, 6, 10, 2, '#7A5520', OUT, 1.5);
    },
  },
  coffeeTable: {
    w: 108,
    h: 66,
    body: { w: 100, h: 30 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 10);
      block(ctx, 4, 6, w - 8, 34, 14, '#8C5A3A', 10);
      for (const lx of [12, w - 20]) fillRound(ctx, lx, 50, 8, 12, 2, '#5C3A24', OUT, 1.5);
      // A brass tray with two glasses of tea.
      ellipse(ctx, w / 2, 22, 26, 11, '#D9AE52', OUT, 1.5);
      for (const gx of [w / 2 - 10, w / 2 + 10]) {
        fillRound(ctx, gx - 4, 12, 8, 12, 2, 'rgba(180, 70, 30, 0.85)', OUT, 1);
        ellipse(ctx, gx, 12, 4, 1.5, 'rgba(255,255,255,0.6)');
      }
      ellipse(ctx, w / 2 + 26, 24, 5, 3, '#F4EBD0', OUT, 1);
    },
  },
  tvUnit: {
    w: 156,
    h: 112,
    body: { w: 150, h: 26 },
    draw(ctx, w) {
      block(ctx, 6, 60, w - 12, 14, 34, '#6E4A33', 6);
      for (let i = 0; i < 3; i++) {
        fillRound(ctx, 14 + i * ((w - 28) / 3), 78, (w - 28) / 3 - 6, 22, 4, '#5B3C29', OUT, 1.5);
        knob(ctx, 14 + i * ((w - 28) / 3) + (w - 28) / 6 - 3, 89);
      }
      // The screen.
      fillRound(ctx, 22, 4, w - 44, 58, 6, '#1F1B24', OUT, 2.5);
      const g = ctx.createLinearGradient(26, 8, w - 26, 58);
      g.addColorStop(0, '#3A4D6B');
      g.addColorStop(1, '#1C2433');
      fillRound(ctx, 27, 9, w - 54, 46, 3, g);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(30, 12);
      ctx.lineTo(70, 12);
      ctx.lineTo(48, 52);
      ctx.lineTo(30, 52);
      ctx.fill();
      fillRound(ctx, w / 2 - 10, 60, 20, 4, 2, '#2A2530');
    },
  },
  rugLiving: {
    w: 264,
    h: 156,
    body: null,
    flat: true,
    draw(ctx, w, h) {
      kilim(ctx, w, h, ['#A63D40', '#E9B872', '#2F6E6A', '#F3E3C3']);
    },
  },
  rugBedroom: {
    w: 168,
    h: 108,
    body: null,
    flat: true,
    draw(ctx, w, h) {
      kilim(ctx, w, h, ['#6B4E8A', '#F2C14E', '#E8735A', '#F6E7D0']);
    },
  },
  rugNursery: {
    w: 156,
    h: 108,
    body: null,
    flat: true,
    draw(ctx, w, h) {
      fillRound(ctx, 2, 2, w - 4, h - 4, 40, '#F7E1D7', '#E2B8A8', 3);
      fillRound(ctx, 14, 14, w - 28, h - 28, 30, '#FBEFE6', '#EBC9B9', 2);
      for (let i = 0; i < 6; i++) ellipse(ctx, 32 + i * 18, h / 2 + Math.sin(i) * 8, 5, 5, ['#9ED2C6', '#F6C177', '#F4A6A6'][i % 3]);
    },
  },
  plant: {
    w: 48,
    h: 84,
    body: { w: 30, h: 18 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 8);
      const leaves = ['#3F8F5A', '#2F7A4A', '#57A86B'];
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (i - 4) * 0.33;
        const len = 26 + (i % 3) * 6;
        ctx.save();
        ctx.translate(w / 2, 50);
        ctx.rotate(a + Math.PI / 2);
        ellipse(ctx, 0, -len / 2, 6, len / 2, leaves[i % 3], OUT, 1.5);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.moveTo(10, 50);
      ctx.lineTo(w - 10, 50);
      ctx.lineTo(w - 14, h - 6);
      ctx.lineTo(14, h - 6);
      ctx.closePath();
      ctx.fillStyle = vGradient(ctx, 50, h, '#D4774E', '#A4532F');
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      fillRound(ctx, 8, 46, w - 16, 8, 3, '#E08A5C', OUT, 1.5);
    },
  },
  floorLamp: {
    w: 40,
    h: 100,
    body: { w: 18, h: 12 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 8);
      ctx.fillStyle = 'rgba(255, 220, 140, 0.25)';
      ellipse(ctx, w / 2, 22, 19, 19, 'rgba(255, 214, 140, 0.25)');
      capsule(ctx, w / 2, 34, w / 2, h - 10, 3, '#5C3A24');
      ellipse(ctx, w / 2, h - 8, 11, 4, '#5C3A24', OUT, 1.5);
      ctx.beginPath();
      ctx.moveTo(8, 34);
      ctx.lineTo(w - 8, 34);
      ctx.lineTo(w - 13, 10);
      ctx.lineTo(13, 10);
      ctx.closePath();
      ctx.fillStyle = vGradient(ctx, 10, 34, '#FFF1C9', '#F2C97A');
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
    },
  },
  bookshelf: {
    w: 100,
    h: 120,
    body: { w: 96, h: 26 },
    draw(ctx, w) {
      block(ctx, 4, 4, w - 8, 12, 108, '#8A5A3C', 4);
      const colors = ['#C0504D', '#4F81BD', '#9BBB59', '#F2C14E', '#8064A2', '#E8735A'];
      for (let shelf = 0; shelf < 3; shelf++) {
        const sy = 24 + shelf * 32;
        ctx.fillStyle = '#5B3C29';
        ctx.fillRect(10, sy + 24, w - 20, 4);
        let bx = 12;
        let i = shelf * 2;
        while (bx < w - 22) {
          const bw = 6 + ((i * 7) % 5);
          const bh = 16 + ((i * 3) % 8);
          fillRound(ctx, bx, sy + 24 - bh, bw, bh, 1.5, colors[i % colors.length], OUT, 1);
          bx += bw + 1;
          i++;
        }
      }
    },
  },
  sideTable: {
    w: 52,
    h: 64,
    body: { w: 44, h: 22 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 6);
      block(ctx, 4, 16, w - 8, 16, 28, '#8C5A3A', 6);
      knob(ctx, w / 2, 48);
      // A phone with a notification.
      fillRound(ctx, w / 2 - 8, 12, 16, 10, 2, '#22252B', OUT, 1.2);
      ellipse(ctx, w / 2 + 7, 11, 3, 3, '#E85D5D');
    },
  },
  desk: {
    w: 112,
    h: 92,
    body: { w: 104, h: 30 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 8);
      block(ctx, 4, 36, w - 8, 20, 10, '#A8734F', 4);
      for (const lx of [10, w - 18]) fillRound(ctx, lx, 64, 8, 24, 2, '#7A5236', OUT, 1.5);
      // Laptop.
      fillRound(ctx, w / 2 - 26, 6, 52, 34, 4, '#2C2F36', OUT, 2);
      fillRound(ctx, w / 2 - 22, 10, 44, 26, 2, '#7FB3D5');
      ctx.fillStyle = '#FFFFFF';
      for (let i = 0; i < 3; i++) ctx.fillRect(w / 2 - 16, 15 + i * 7, 18 + i * 4, 3);
      fillRound(ctx, w / 2 - 30, 38, 60, 8, 3, '#B9BEC6', OUT, 1.5);
      ellipse(ctx, w - 22, 44, 6, 4, '#F4EBD0', OUT, 1);
    },
  },
  diningTable: {
    w: 156,
    h: 112,
    body: { w: 140, h: 40 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 8);
      for (const cx of [30, 78, 126]) chairBack(ctx, cx - 14, 0);
      block(ctx, 6, 24, w - 12, 46, 12, '#9B6640', 10);
      ctx.fillStyle = 'rgba(255, 245, 225, 0.9)';
      roundRect(ctx, 24, 30, w - 48, 34, 8);
      ctx.fill();
      ellipse(ctx, w / 2, 46, 14, 8, '#F2F0EA', OUT, 1.5);
      ellipse(ctx, w / 2, 44, 9, 5, '#E9A23B');
      for (const lx of [14, w - 22]) fillRound(ctx, lx, 80, 8, 24, 2, '#6B4429', OUT, 1.5);
      for (const cx of [30, 78, 126]) fillRound(ctx, cx - 14, 92, 28, 14, 4, '#B5814F', OUT, 1.5);
    },
  },
  boxes: {
    w: 72,
    h: 76,
    body: { w: 66, h: 34 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 6);
      cardboard(ctx, 4, 30, 40, 42);
      cardboard(ctx, 30, 36, 38, 36);
      cardboard(ctx, 14, 4, 34, 32);
    },
  },
  shoeRack: {
    w: 84,
    h: 64,
    body: { w: 80, h: 24 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 6);
      block(ctx, 4, 16, w - 8, 12, 36, '#8C5A3A', 4);
      const pairs = ['#3B2A22', '#E8735A', '#3E7CB1'];
      pairs.forEach((c, i) => {
        ellipse(ctx, 18 + i * 22, 14, 6, 4, c, OUT, 1.2);
        ellipse(ctx, 26 + i * 22, 15, 6, 4, c, OUT, 1.2);
      });
    },
  },
  // ----------------------------------------------------------------------------- wall fixtures
  window: {
    w: 104,
    h: 84,
    body: null,
    wall: true,
    draw(ctx, w) {
      fillRound(ctx, 8, 6, w - 16, 64, 6, '#7B4B2E', OUT, 2);
      const sky = ctx.createLinearGradient(0, 10, 0, 66);
      sky.addColorStop(0, '#9FD4F0');
      sky.addColorStop(1, '#E9F5FB');
      fillRound(ctx, 14, 12, w - 28, 52, 3, sky);
      // Distant minaret and rooftops.
      ctx.fillStyle = '#D9C3A5';
      ctx.fillRect(20, 46, 18, 18);
      ctx.fillRect(40, 40, 14, 24);
      ctx.fillRect(w - 46, 34, 6, 30);
      ellipse(ctx, w - 43, 34, 4, 5, '#D9C3A5');
      ctx.fillRect(w - 36, 50, 22, 14);
      // Mashrabiya-style wooden lattice.
      ctx.strokeStyle = 'rgba(123, 75, 46, 0.85)';
      ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(14 + i * ((w - 28) / 4), 12);
        ctx.lineTo(14 + i * ((w - 28) / 4), 64);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(14, 38);
      ctx.lineTo(w - 14, 38);
      ctx.stroke();
      // Curtains.
      for (const [x0, dir] of [[2, 1], [w - 2, -1]] as const) {
        ctx.beginPath();
        ctx.moveTo(x0, 2);
        ctx.lineTo(x0 + dir * 20, 2);
        ctx.quadraticCurveTo(x0 + dir * 10, 40, x0 + dir * 16, 78);
        ctx.lineTo(x0, 78);
        ctx.closePath();
        ctx.fillStyle = vGradient(ctx, 2, 78, '#E07A5F', '#B85C46');
        ctx.fill();
        ctx.strokeStyle = OUT;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      fillRound(ctx, 0, 0, w, 6, 3, '#5C3A24', OUT, 1.5);
    },
  },
  clock: {
    w: 40,
    h: 44,
    body: null,
    wall: true,
    draw(ctx) {
      ellipse(ctx, 20, 20, 17, 17, '#7B4B2E', OUT, 2);
      ellipse(ctx, 20, 20, 13, 13, '#FFF8E7');
      capsule(ctx, 20, 20, 20, 11, 2, '#3B2416');
      capsule(ctx, 20, 20, 27, 22, 2, '#3B2416');
    },
  },
  photos: {
    w: 88,
    h: 52,
    body: null,
    wall: true,
    draw(ctx) {
      fillRound(ctx, 4, 8, 34, 40, 3, '#C9A04A', OUT, 2);
      fillRound(ctx, 9, 13, 24, 30, 2, '#F6E3C6');
      ellipse(ctx, 16, 26, 4, 4, '#C98B62');
      ellipse(ctx, 26, 26, 4, 4, '#D9A07A');
      fillRound(ctx, 46, 4, 38, 30, 3, '#7B4B2E', OUT, 2);
      fillRound(ctx, 51, 9, 28, 20, 2, '#BFE3D0');
      ctx.fillStyle = '#E9C46A';
      ctx.beginPath();
      ctx.moveTo(56, 26);
      ctx.lineTo(65, 14);
      ctx.lineTo(74, 26);
      ctx.fill();
    },
  },
  kitchenShelf: {
    w: 120,
    h: 60,
    body: null,
    wall: true,
    draw(ctx, w) {
      fillRound(ctx, 4, 40, w - 8, 8, 3, '#8C5A3A', OUT, 2);
      const jars = ['#E9C46A', '#E76F51', '#2A9D8F', '#F4A261'];
      jars.forEach((c, i) => {
        fillRound(ctx, 12 + i * 26, 16, 18, 24, 5, 'rgba(255,255,255,0.7)', OUT, 1.5);
        fillRound(ctx, 14 + i * 26, 26, 14, 12, 3, c);
        fillRound(ctx, 11 + i * 26, 12, 20, 6, 2, '#7B4B2E', OUT, 1);
      });
    },
  },
  // ----------------------------------------------------------------------------- bedroom
  bed: {
    w: 150,
    h: 184,
    body: { w: 144, h: 140 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 4);
      // Headboard.
      fillRound(ctx, 6, 2, w - 12, 50, 18, vGradient(ctx, 2, 52, '#9A6A45', '#6E4A33'), OUT, 2.5);
      fillRound(ctx, 18, 12, w - 36, 30, 10, '#B88456', OUT, 1.5);
      // Mattress and blanket.
      fillRound(ctx, 8, 36, w - 16, h - 44, 14, '#F6EFE3', OUT, 2);
      ellipse(ctx, 44, 56, 26, 13, '#FFFFFF', OUT, 1.5);
      ellipse(ctx, w - 44, 56, 26, 13, '#FFFFFF', OUT, 1.5);
      fillRound(ctx, 8, 80, w - 16, h - 88, 14, vGradient(ctx, 80, h, '#E8735A', '#C4553F'), OUT, 2);
      ctx.strokeStyle = 'rgba(255, 230, 200, 0.6)';
      ctx.lineWidth = 2;
      for (let y = 100; y < h - 20; y += 22) {
        ctx.beginPath();
        ctx.moveTo(16, y);
        ctx.lineTo(w - 16, y);
        ctx.stroke();
      }
      fillRound(ctx, 8, 80, w - 16, 16, 8, '#F7D6C8', OUT, 1.5);
    },
  },
  wardrobe: {
    w: 128,
    h: 136,
    body: { w: 124, h: 34 },
    draw(ctx, w) {
      block(ctx, 4, 4, w - 8, 14, 116, '#8A5A3C', 4);
      for (let i = 0; i < 2; i++) {
        fillRound(ctx, 12 + i * ((w - 24) / 2), 24, (w - 24) / 2 - 4, 92, 4, '#9C6A48', OUT, 1.5);
        fillRound(ctx, 20 + i * ((w - 24) / 2), 34, (w - 24) / 2 - 20, 72, 3, 'rgba(255, 255, 255, 0.12)');
      }
      knob(ctx, w / 2 - 8, 70);
      knob(ctx, w / 2 + 6, 70);
    },
  },
  nightstand: {
    w: 48,
    h: 64,
    body: { w: 42, h: 22 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 6);
      block(ctx, 4, 18, w - 8, 14, 28, '#8A5A3C', 5);
      knob(ctx, w / 2, 46);
      ellipse(ctx, w / 2, 14, 9, 4, '#E9C46A', OUT, 1.2);
      ellipse(ctx, w / 2, 6, 8, 7, 'rgba(255, 230, 160, 0.9)', OUT, 1.2);
    },
  },
  // ----------------------------------------------------------------------------- kitchen
  fridge: {
    w: 68,
    h: 120,
    body: { w: 64, h: 32 },
    draw(ctx, w) {
      block(ctx, 4, 4, w - 8, 10, 104, '#E8EEF0', 8);
      ctx.strokeStyle = '#A9B6BC';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(8, 50);
      ctx.lineTo(w - 8, 50);
      ctx.stroke();
      fillRound(ctx, w - 18, 24, 5, 20, 2, '#A9B6BC');
      fillRound(ctx, w - 18, 58, 5, 30, 2, '#A9B6BC');
      // Magnets and a note.
      ellipse(ctx, 18, 30, 4, 4, '#E76F51');
      ellipse(ctx, 30, 70, 4, 4, '#2A9D8F');
    },
  },
  stove: {
    w: 68,
    h: 92,
    body: { w: 64, h: 32 },
    draw(ctx, w) {
      block(ctx, 4, 6, w - 8, 26, 56, '#D7DDE0', 6);
      for (const [x, y] of [[20, 14], [w - 20, 14], [20, 25], [w - 20, 25]]) ellipse(ctx, x, y, 7, 4, '#3A3A3A', OUT, 1);
      fillRound(ctx, 12, 44, w - 24, 30, 4, '#2D3238', OUT, 1.5);
      fillRound(ctx, 16, 48, w - 32, 10, 3, 'rgba(255,160,90,0.4)');
      for (let i = 0; i < 4; i++) ellipse(ctx, 14 + i * 13, 38, 2.6, 2.6, '#5A5F66');
      // A kettle.
      ellipse(ctx, w - 20, 8, 9, 7, '#C0504D', OUT, 1.5);
    },
  },
  counter: {
    w: 120,
    h: 88,
    body: { w: 116, h: 32 },
    draw(ctx, w) {
      block(ctx, 4, 10, w - 8, 22, 52, '#C59A6D', 5);
      ctx.fillStyle = '#EDE6DA';
      roundRect(ctx, 6, 10, w - 12, 20, 4);
      ctx.fill();
      for (let i = 0; i < 2; i++) {
        fillRound(ctx, 12 + i * ((w - 24) / 2), 40, (w - 24) / 2 - 4, 26, 3, '#B5895F', OUT, 1.5);
        knob(ctx, 12 + i * ((w - 24) / 2) + (w - 24) / 4 - 2, 52);
      }
      // Sink with a tap.
      fillRound(ctx, w / 2 - 22, 13, 44, 14, 4, '#B6C4CB', OUT, 1.5);
      capsule(ctx, w / 2, 6, w / 2, 14, 3, '#9AA7AD');
      ellipse(ctx, 22, 10, 7, 5, '#2A9D8F', OUT, 1);
    },
  },
  // ----------------------------------------------------------------------------- nursery (level 3 pieces)
  crib: {
    w: 96,
    h: 144,
    body: { w: 92, h: 120 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 4);
      fillRound(ctx, 6, 4, w - 12, h - 10, 10, '#F4E4C9', OUT, 2.5);
      // Firm mattress with a fitted sheet.
      fillRound(ctx, 14, 16, w - 28, h - 34, 6, '#DDF0F5', OUT, 1.5);
      ctx.strokeStyle = 'rgba(120, 170, 190, 0.35)';
      ctx.lineWidth = 1.5;
      for (let y = 26; y < h - 20; y += 12) {
        ctx.beginPath();
        ctx.moveTo(16, y);
        ctx.lineTo(w - 16, y);
        ctx.stroke();
      }
      // Slats.
      ctx.strokeStyle = '#D8C3A0';
      ctx.lineWidth = 3;
      for (let x = 14; x <= w - 14; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, h - 18);
        ctx.lineTo(x, h - 8);
        ctx.stroke();
      }
      fillRound(ctx, 4, 2, w - 8, 10, 5, '#E9D3AE', OUT, 2);
      fillRound(ctx, 4, h - 20, w - 8, 10, 5, '#E9D3AE', OUT, 2);
    },
  },
  changingTable: {
    w: 100,
    h: 80,
    body: { w: 96, h: 34 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 6);
      block(ctx, 4, 10, w - 8, 26, 40, '#F2E6D4', 6);
      fillRound(ctx, 12, 12, w - 24, 22, 8, '#A7D3C9', OUT, 1.5);
      fillRound(ctx, 12, 44, (w - 32) / 2, 18, 3, '#E8D7BF', OUT, 1.2);
      fillRound(ctx, w / 2 + 4, 44, (w - 32) / 2, 18, 3, '#E8D7BF', OUT, 1.2);
      knob(ctx, w / 4 + 4, 53);
      knob(ctx, (3 * w) / 4 - 4, 53);
    },
  },
  dresser: {
    w: 100,
    h: 84,
    body: { w: 96, h: 34 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 6);
      block(ctx, 4, 6, w - 8, 16, 58, '#C8A27A', 6);
      for (let i = 0; i < 3; i++) {
        fillRound(ctx, 12, 26 + i * 18, w - 24, 14, 3, '#D7B48C', OUT, 1.2);
        knob(ctx, w / 2, 33 + i * 18);
      }
      ctx.fillStyle = '#FFFFFF';
      ellipse(ctx, 24, 10, 8, 4, '#F4A6A6', OUT, 1);
    },
  },
  kidsWardrobe: {
    w: 136,
    h: 124,
    body: { w: 132, h: 34 },
    draw(ctx, w) {
      block(ctx, 4, 4, w - 8, 14, 104, '#E9D8BD', 6);
      for (let i = 0; i < 2; i++) {
        fillRound(ctx, 12 + i * ((w - 24) / 2), 24, (w - 24) / 2 - 4, 82, 5, '#F3E5CF', OUT, 1.5);
        ellipse(ctx, 12 + i * ((w - 24) / 2) + (w - 24) / 4 - 2, 50, 10, 10, i ? '#F4A6A6' : '#9ED2C6');
      }
      knob(ctx, w / 2 - 8, 66);
      knob(ctx, w / 2 + 6, 66);
    },
  },
  rockingChair: {
    w: 64,
    h: 88,
    body: { w: 56, h: 30 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 6);
      fillRound(ctx, 12, 4, w - 24, 48, 10, '#C99A6B', OUT, 2);
      fillRound(ctx, 17, 10, w - 34, 36, 8, '#F4C7B8', OUT, 1.5);
      fillRound(ctx, 8, 46, w - 16, 18, 7, '#F4C7B8', OUT, 2);
      ctx.strokeStyle = '#8A5A3C';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w / 2, h - 50, 40, Math.PI * 0.32, Math.PI * 0.68);
      ctx.stroke();
      for (const lx of [14, w - 18]) fillRound(ctx, lx, 60, 4, 14, 2, '#8A5A3C');
    },
  },
  toyShelf: {
    w: 100,
    h: 76,
    body: { w: 96, h: 30 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 6);
      block(ctx, 4, 10, w - 8, 12, 50, '#E8C9A0', 5);
      for (let i = 0; i < 3; i++) fillRound(ctx, 10 + i * ((w - 20) / 3), 28, (w - 20) / 3 - 4, 26, 4, ['#9ED2C6', '#F6C177', '#F4A6A6'][i], OUT, 1.2);
    },
  },
  nurseryLamp: {
    w: 40,
    h: 64,
    body: { w: 22, h: 14 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 8);
      ellipse(ctx, w / 2, 22, 18, 18, 'rgba(255, 220, 150, 0.3)');
      capsule(ctx, w / 2, 30, w / 2, h - 10, 3, '#B07F55');
      ellipse(ctx, w / 2, h - 8, 10, 4, '#B07F55', OUT, 1.5);
      ellipse(ctx, w / 2, 22, 12, 11, '#FFF3D0', OUT, 2);
    },
  },
  // ----------------------------------------------------------------------------- shop
  shopShelf: {
    w: 192,
    h: 112,
    body: { w: 188, h: 34 },
    draw(ctx, w) {
      block(ctx, 4, 4, w - 8, 10, 98, '#E9EEF0', 4);
      const stock = ['#9ED2C6', '#F6C177', '#F4A6A6', '#7FB3D5', '#C9B6E4', '#FFE08A'];
      for (let i = 0; i < 3; i++) {
        const shelfY = 36 + i * 28;
        // Packs and boxes standing on each shelf.
        let x = 12;
        let n = i * 3;
        while (x < w - 24) {
          const bw = 12 + ((n * 5) % 9);
          const bh = 12 + ((n * 7) % 9);
          fillRound(ctx, x, shelfY - bh, bw, bh, 3, stock[n % stock.length], OUT, 1.2);
          if (n % 3 === 0) ellipse(ctx, x + bw / 2, shelfY - bh / 2, 2.5, 2.5, '#FFFFFF');
          x += bw + 3;
          n++;
        }
        ctx.fillStyle = '#B9C6CC';
        ctx.fillRect(8, shelfY, w - 16, 4);
      }
      ctx.fillStyle = '#7FB77E';
      ctx.fillRect(8, 16, w - 16, 6);
    },
  },
  cashier: {
    w: 156,
    h: 96,
    body: { w: 150, h: 40 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 6);
      block(ctx, 4, 16, w - 8, 28, 44, '#7FB77E', 8);
      fillRound(ctx, 14, 52, w - 28, 26, 4, '#6AA06A', OUT, 1.2);
      // Till.
      fillRound(ctx, w - 58, 2, 40, 28, 4, '#3A3F47', OUT, 2);
      fillRound(ctx, w - 54, 6, 32, 12, 2, '#9FE0A0');
      ctx.fillStyle = '#1D3B1F';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText('EGP', w - 50, 15);
      // Conveyor stripes.
      ctx.fillStyle = '#2E3238';
      ctx.fillRect(14, 22, 70, 14);
      ctx.fillStyle = '#4A5059';
      for (let x = 18; x < 84; x += 10) ctx.fillRect(x, 22, 3, 14);
    },
  },
  trolley: {
    w: 84,
    h: 76,
    body: { w: 70, h: 26 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 8);
      ctx.strokeStyle = '#6C7A86';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(6, 8);
      ctx.lineTo(16, 12);
      ctx.lineTo(20, 52);
      ctx.lineTo(w - 10, 52);
      ctx.lineTo(w - 4, 16);
      ctx.lineTo(16, 16);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      for (let x = 24; x < w - 8; x += 9) {
        ctx.beginPath();
        ctx.moveTo(x, 18);
        ctx.lineTo(x + 2, 50);
        ctx.stroke();
      }
      for (let y = 26; y < 50; y += 9) {
        ctx.beginPath();
        ctx.moveTo(18, y);
        ctx.lineTo(w - 6, y);
        ctx.stroke();
      }
      for (const wx of [24, w - 14]) ellipse(ctx, wx, h - 12, 6, 6, '#2E3238', OUT, 1.5);
    },
  },
  shutter: {
    w: 144,
    h: 96,
    body: null,
    wall: true,
    draw(ctx, w, h) {
      fillRound(ctx, 4, 4, w - 8, h - 8, 4, '#8E9AA3', OUT, 2.5);
      ctx.strokeStyle = '#6E7A83';
      ctx.lineWidth = 2;
      for (let y = 12; y < h - 8; y += 8) {
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(w - 8, y);
        ctx.stroke();
      }
    },
  },
  storeroomBack: {
    w: 144,
    h: 96,
    body: null,
    wall: true,
    draw(ctx, w, h) {
      fillRound(ctx, 4, 4, w - 8, h - 8, 4, '#5A4A3E', OUT, 2.5);
      for (let i = 0; i < 3; i++) cardboard(ctx, 14 + i * 40, 40, 34, 40);
    },
  },
  button: {
    w: 44,
    h: 52,
    body: null,
    wall: true,
    draw(ctx) {
      fillRound(ctx, 6, 6, 32, 40, 6, '#E9EEF0', OUT, 2);
      ellipse(ctx, 22, 26, 10, 10, '#E85D5D', OUT, 2);
      ellipse(ctx, 19, 23, 3, 2, 'rgba(255,255,255,0.6)');
    },
  },
  plate: {
    w: 64,
    h: 40,
    body: null,
    flat: true,
    draw(ctx, w, h) {
      ellipse(ctx, w / 2, h / 2, w / 2 - 3, h / 2 - 3, '#C8D2D8', OUT, 2);
      ellipse(ctx, w / 2, h / 2 - 2, w / 2 - 10, h / 2 - 9, '#F2C14E', OUT, 1.5);
    },
  },
  streetLamp: {
    w: 40,
    h: 140,
    body: { w: 14, h: 10 },
    draw(ctx, w, h) {
      shadowUnder(ctx, w, h, 10);
      capsule(ctx, w / 2, 24, w / 2, h - 8, 5, '#2F3A40');
      ellipse(ctx, w / 2, 18, 15, 15, 'rgba(255, 220, 140, 0.35)');
      fillRound(ctx, w / 2 - 9, 8, 18, 18, 4, '#FFE7A8', OUT, 2);
    },
  },
  shopSign: {
    w: 220,
    h: 56,
    body: null,
    wall: true,
    draw(ctx, w, h) {
      fillRound(ctx, 2, 4, w - 4, h - 8, 10, '#2A9D8F', OUT, 2.5);
      fillRound(ctx, 8, 10, w - 16, h - 20, 7, '#F4FBF8');
      ctx.fillStyle = '#2A9D8F';
      ctx.font = 'bold 22px "Baloo Bhaijaan 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.direction = 'rtl';
      ctx.fillText('عالم البيبي', w / 2, h / 2 + 1);
    },
  },
};

function chairBack(ctx: Ctx, x: number, y: number): void {
  fillRound(ctx, x, y, 28, 34, 8, '#B5814F', OUT, 1.5);
  fillRound(ctx, x + 5, y + 5, 18, 20, 5, '#D9A86C');
}

function cardboard(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  fillRound(ctx, x, y, w, h, 3, vGradient(ctx, y, y + h, '#D9A86C', '#B5814F'), OUT, 2);
  ctx.fillStyle = '#E9C99A';
  ctx.fillRect(x + w / 2 - 4, y + 1, 8, h - 2);
  ctx.strokeStyle = 'rgba(80, 50, 20, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 8);
  ctx.lineTo(x + w - 4, y + 8);
  ctx.stroke();
}

function kilim(ctx: Ctx, w: number, h: number, [a, b, c, d]: string[]): void {
  fillRound(ctx, 2, 2, w - 4, h - 4, 6, a, OUT, 2);
  fillRound(ctx, 10, 10, w - 20, h - 20, 4, d);
  fillRound(ctx, 18, 18, w - 36, h - 36, 3, b);
  // Rows of diamonds.
  const rows = 3;
  for (let r = 0; r < rows; r++) {
    const cy = 26 + ((h - 52) * (r + 0.5)) / rows;
    for (let x = 34; x < w - 30; x += 28) {
      ctx.fillStyle = r % 2 ? c : a;
      ctx.beginPath();
      ctx.moveTo(x, cy - 9);
      ctx.lineTo(x + 10, cy);
      ctx.lineTo(x, cy + 9);
      ctx.lineTo(x - 10, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = d;
      ctx.beginPath();
      ctx.arc(x, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Fringe.
  ctx.strokeStyle = '#F3E3C3';
  ctx.lineWidth = 1.5;
  for (let y = 8; y < h - 6; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(4, y);
    ctx.moveTo(w - 4, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

export function drawProp(key: string): HTMLCanvasElement {
  const art = PROPS[key];
  if (!art) throw new Error(`No art for prop '${key}'`);
  const { canvas, ctx } = makeCanvas(art.w, art.h);
  ctx.lineJoin = 'round';
  art.draw(ctx, art.w, art.h);
  return canvas;
}
