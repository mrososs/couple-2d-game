/**
 * Development tool (art-export.html): renders the game's own procedural art to PNG files for the
 * native screens - character portraits for every outfit, a hero image, and one picture per level -
 * and posts them to the Vite dev server, which writes them to assets/art. Run it after changing
 * the character or prop drawings: `npm run web`, then open /art-export.html.
 */
import type { CharacterId } from '../game/bridge/protocol.ts';
import { makeCanvas, contactShadow } from '../game/phaser/art/canvas-kit.ts';
import { drawCharacter, drawPortrait, OUTFITS } from '../game/phaser/art/characters.ts';
import { drawCard, drawItem } from '../game/phaser/art/items.ts';
import { drawPiece } from '../game/phaser/art/pieces.ts';
import { drawProp } from '../game/phaser/art/props.ts';

async function save(name: string, canvas: HTMLCanvasElement): Promise<string> {
  const res = await fetch('/__art', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, png: canvas.toDataURL('image/png') }) });
  return `${name}: ${res.status}`;
}

function scaled(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(source.width * scale, source.height * scale);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function couple(wifeOutfit: number, husbandOutfit: number, pose: 'cheer' | 'rest'): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(300, 220);
  ctx.scale(2, 2);
  contactShadow(ctx, 50, 100, 26, 7);
  contactShadow(ctx, 100, 100, 26, 7);
  const arms = pose === 'cheer' ? 'cheer' : 'rest';
  for (const [id, outfit, x] of [['husband', husbandOutfit, 68], ['wife', wifeOutfit, 18]] as const) {
    ctx.save();
    ctx.translate(x, 12);
    drawCharacter(ctx, id as CharacterId, OUTFITS[id as CharacterId][outfit], { dir: 'down', step: 0, bob: 0, arms, face: pose === 'cheer' ? 'joy' : 'happy' });
    ctx.restore();
  }
  return canvas;
}

function levelPicture(level: 1 | 2 | 3): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(360, 220);
  const place = (img: HTMLCanvasElement, x: number, y: number, s = 1) => ctx.drawImage(img, x - (img.width * s) / 2, y - img.height * s, img.width * s, img.height * s);
  if (level === 1) {
    place(drawCard('calendar', '#F2C14E'), 90, 120, 1.6);
    place(drawCard('hospital', '#F2C14E'), 180, 110, 1.8);
    place(drawCard('cart', '#F2C14E'), 270, 120, 1.6);
    place(drawCard('moon', '#F2C14E'), 130, 210, 1.4);
    place(drawCard('family', '#F2C14E'), 230, 210, 1.4);
  } else if (level === 2) {
    place(drawProp('trolley'), 180, 205, 1.8);
    place(drawItem('diapers-l'), 150, 130, 1.4);
    place(drawItem('clothes'), 215, 120, 1.3);
    place(drawItem('bath'), 110, 190, 1.0);
    place(drawItem('firstAid'), 265, 195, 1.1);
  } else {
    place(drawPiece('crib', 3, 2), 180, 200, 1.1);
    place(drawItem('pillow'), 70, 120, 1.3);
    place(drawItem('plush'), 295, 110, 1.3);
    place(drawProp('nurseryLamp'), 320, 210, 1.2);
  }
  return canvas;
}

async function run(): Promise<void> {
  const log = document.getElementById('log')!;
  const lines: string[] = [];
  for (const id of ['wife', 'husband'] as const) {
    for (let i = 0; i < OUTFITS[id].length; i++) {
      lines.push(await save(`${id}-${i}`, drawPortrait(id, OUTFITS[id][i], 256)));
    }
  }
  lines.push(await save('couple', couple(0, 0, 'rest')));
  lines.push(await save('couple-cheer', couple(0, 0, 'cheer')));
  for (const level of [1, 2, 3] as const) lines.push(await save(`level-${level}`, levelPicture(level)));
  lines.push(await save('crib-preview', scaled(drawPiece('crib', 2, 3), 1)));
  log.textContent = lines.join('\n');
  document.title = 'art exported';
}

void run();
