import type { CharacterId } from '../../game/bridge/protocol.ts';
import couple from '../../../assets/art/couple.png';
import coupleCheer from '../../../assets/art/couple-cheer.png';
import husband0 from '../../../assets/art/husband-0.png';
import husband1 from '../../../assets/art/husband-1.png';
import husband2 from '../../../assets/art/husband-2.png';
import level1 from '../../../assets/art/level-1.png';
import level2 from '../../../assets/art/level-2.png';
import level3 from '../../../assets/art/level-3.png';
import wife0 from '../../../assets/art/wife-0.png';
import wife1 from '../../../assets/art/wife-1.png';
import wife2 from '../../../assets/art/wife-2.png';

/**
 * Pictures for the native screens, rendered from the game's own drawing code by art-export.html,
 * so the characters on the menus are the ones in the game. Metro turns an imported PNG into an
 * asset id that `<image>` resolves; Vite turns it into a URL, which `<image>` takes as `{ uri }`.
 */

export type ImageSource = number | { uri: string };

export function source(asset: unknown): ImageSource {
  return typeof asset === 'string' ? { uri: asset } : (asset as number);
}

const PORTRAITS: Record<CharacterId, readonly unknown[]> = {
  wife: [wife0, wife1, wife2],
  husband: [husband0, husband1, husband2],
};

export function portrait(id: CharacterId, outfit: number): ImageSource {
  return source(PORTRAITS[id][outfit] ?? PORTRAITS[id][0]);
}

export const ART = {
  couple: source(couple),
  coupleCheer: source(coupleCheer),
  levels: [source(level1), source(level2), source(level3)],
} as const;
