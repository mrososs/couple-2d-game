import type Phaser from 'phaser';
import type { CharacterId, LevelResult } from '../../bridge/protocol.ts';
import type { DecorPlacement } from '../../domain/levels/apartment-decor.ts';
import type { LevelContent } from '../../domain/levels/content.ts';
import type { ObjectiveManager } from '../../domain/objectives.ts';
import type { MapSpec, TileMap } from '../../domain/tile-map.ts';
import type { HudScene } from '../scenes/hud-scene.ts';
import type { GameServices } from '../services.ts';
import type { CarryHooks, CarrySystem } from '../systems/carry.ts';
import type { JointCarry, JointCarryHooks } from '../systems/cooperation.ts';
import type { Feedback } from '../systems/feedback.ts';
import type { InputHub } from '../systems/input-hub.ts';
import type { InteractionSystem } from '../systems/interaction.ts';
import type { Player } from '../systems/player.ts';

/**
 * The seam between the generic level scene and one level's rules. The scene builds the world a
 * level declares - map, decor, characters, systems - and the controller adds the level's own
 * interactables, puzzle state and win condition on top. Puzzle logic lives in `domain/`, so a
 * controller is mostly wiring: what an interaction does to the puzzle, and what the player sees.
 */

export interface LevelSetup {
  readonly map: MapSpec;
  readonly mapKey: string;
  readonly decor: readonly DecorPlacement[];
  readonly spawns: Readonly<Record<CharacterId, { readonly x: number; readonly y: number }>>;
}

export interface LevelContext {
  readonly scene: Phaser.Scene;
  readonly services: GameServices;
  readonly hud: HudScene;
  readonly map: TileMap;
  readonly players: Readonly<Record<CharacterId, Player>>;
  readonly hub: InputHub;
  readonly interaction: InteractionSystem;
  readonly carry: CarrySystem;
  readonly joint: JointCarry;
  readonly feedback: Feedback;
  readonly objectives: ObjectiveManager;
  /** Static bodies characters and carried furniture collide with. */
  readonly solids: Phaser.Physics.Arcade.StaticGroup;
  /** Decor images by kind, for levels that point at a particular piece. */
  readonly decor: ReadonlyMap<string, Phaser.GameObjects.Image[]>;
  /** Seconds since the level started. */
  elapsed(): number;
  /** Ends the level: celebration here, then the result goes to the app. */
  complete(result: Omit<LevelResult, 'durationSec' | 'levelId'>): void;
  /** Adds an extra static obstacle, returning a way to remove it. */
  addSolid(x: number, y: number, w: number, h: number): Phaser.GameObjects.Zone;
}

export interface LevelController {
  readonly setup: LevelSetup;
  readonly content: LevelContent | null;
  readonly carryHooks?: CarryHooks;
  readonly jointHooks: JointCarryHooks;
  start(ctx: LevelContext): void;
  update(time: number, delta: number): void;
  dispose?(): void;
}
