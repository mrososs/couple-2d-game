import type { SceneId } from '../../bridge/protocol.ts';
import { Level01Controller } from './level01.ts';
import { Level02Controller } from './level02.ts';
import { Level03Controller } from './level03.ts';
import type { LevelController } from './level-controller.ts';
import { SandboxController } from './sandbox.ts';

/** LevelManager's registry: a fresh controller per start, so a restart begins from clean state. */
export function createController(sceneId: SceneId): LevelController {
  switch (sceneId) {
    case 'level01':
      return new Level01Controller();
    case 'level02':
      return new Level02Controller();
    case 'level03':
      return new Level03Controller();
    default:
      return new SandboxController();
  }
}
