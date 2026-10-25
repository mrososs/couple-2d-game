/**
 * Where the furniture stands, in world pixels (TILE = 48). A standing prop's (x, y) is the middle
 * of its bottom edge - the front of its footprint on the floor - so a wardrobe against the top
 * wall has y = wall bottom + its footprint depth and its top overlaps the wall face, as in any
 * three-quarter view. A wall prop's y is the bottom of the wall face it hangs on.
 */

export interface DecorPlacement {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly flipX?: boolean;
}

/** Bottom of the wall faces above the top rooms (row 1) and above the living room (row 10). */
export const TOP_WALL = 92;
export const LIVING_WALL = 524;

export const APARTMENT_DECOR: readonly DecorPlacement[] = [
  // Bedroom
  { kind: 'rugBedroom', x: 330, y: 330 },
  { kind: 'bed', x: 152, y: 282 },
  { kind: 'nightstand', x: 262, y: 120 },
  { kind: 'window', x: 300, y: TOP_WALL },
  { kind: 'desk', x: 432, y: 128 },
  { kind: 'wardrobe', x: 558, y: 132 },
  // Kitchen
  { kind: 'fridge', x: 1394, y: 130 },
  { kind: 'counter', x: 1496, y: 130 },
  { kind: 'stove', x: 1600, y: 130 },
  { kind: 'kitchenShelf', x: 1712, y: TOP_WALL - 4 },
  { kind: 'window', x: 1812, y: TOP_WALL },
  { kind: 'plant', x: 1838, y: 420 },
  // Nursery: still empty apart from its window.
  { kind: 'window', x: 816, y: TOP_WALL },
  // Living room: the salon set facing the TV.
  { kind: 'rugLiving', x: 176, y: 820 },
  { kind: 'tvUnit', x: 150, y: 556 },
  { kind: 'coffeeTable', x: 168, y: 700 },
  { kind: 'sofaBack', x: 172, y: 838 },
  { kind: 'photos', x: 380, y: LIVING_WALL - 8 },
  { kind: 'clock', x: 1032, y: LIVING_WALL - 20 },
  { kind: 'diningTable', x: 1240, y: 930 },
  { kind: 'floorLamp', x: 1010, y: 990 },
  { kind: 'plant', x: 84, y: 1000 },
  { kind: 'plant', x: 1500, y: 1000 },
  // Entrance hall
  { kind: 'shoeRack', x: 1780, y: 556 },
  { kind: 'plant', x: 1838, y: 1000 },
];

/** A second sitting corner in the middle of the living room, kept clear in level 3. */
export const SITTING_CORNER: readonly DecorPlacement[] = [
  { kind: 'armchair', x: 640, y: 880 },
  { kind: 'sideTable', x: 760, y: 870 },
  { kind: 'armchair', x: 880, y: 880, flipX: true },
];

export const STREET_AND_SHOP_DECOR: readonly DecorPlacement[] = [
  { kind: 'streetLamp', x: 2050, y: 640 },
  { kind: 'streetLamp', x: 2050, y: 1000 },
  { kind: 'shopSign', x: 2500, y: 228 },
  { kind: 'shopShelf', x: 2420, y: 470 },
  { kind: 'shopShelf', x: 2420, y: 720 },
  { kind: 'shopShelf', x: 2700, y: 720 },
  { kind: 'cashier', x: 2990, y: 860 },
  { kind: 'button', x: 2664, y: 236 },
  { kind: 'plant', x: 3090, y: 600 },
];
