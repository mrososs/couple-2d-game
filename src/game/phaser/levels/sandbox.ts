import type Phaser from 'phaser';
import { APARTMENT_DECOR, SITTING_CORNER } from '../../domain/levels/apartment-decor.ts';
import { APARTMENT } from '../../domain/tile-map.ts';
import { servicesOf } from '../services.ts';
import type { LevelContext, LevelController, LevelSetup } from './level-controller.ts';

/**
 * The Phase 0 integration room, kept as a smoke test of the whole stack: both characters, walls,
 * touch and keyboard controls, one interactable lamp that reports to the native app over the
 * bridge, and a box to carry. It has no win condition.
 */
export class SandboxController implements LevelController {
  readonly content = null;
  readonly setup: LevelSetup = {
    map: APARTMENT,
    mapKey: 'apartment',
    decor: [...APARTMENT_DECOR, ...SITTING_CORNER],
    spawns: { wife: { x: 720, y: 720 }, husband: { x: 840, y: 720 } },
  };
  readonly jointHooks = { onPutDown: () => 'ground' as const };
  private ctx!: LevelContext;
  private lampOn = false;
  private glow!: Phaser.GameObjects.Image;

  start(ctx: LevelContext): void {
    this.ctx = ctx;
    const lamp = ctx.decor.get('floorLamp')![0];
    this.glow = ctx.scene.add.image(lamp.x, lamp.y - 80, 'glow').setBlendMode('ADD').setScale(1.6).setAlpha(0).setDepth(9999);
    ctx.interaction.add({
      id: 'lamp',
      x: lamp.x,
      y: lamp.y,
      radius: 80,
      indicatorHeight: 120,
      target: lamp,
      prompt: () => (this.lampOn ? 'اطفي' : 'نوّر'),
      interact: (actor) => {
        this.lampOn = !this.lampOn;
        ctx.scene.tweens.add({ targets: this.glow, alpha: this.lampOn ? 0.9 : 0, duration: 250 });
        ctx.feedback.play(this.lampOn ? 'chime' : 'soft');
        ctx.feedback.say(actor, this.lampOn ? 'أحلى كده ✨' : 'تصبحوا على خير 🌙', 1600);
        const { session, emit } = servicesOf(ctx.scene);
        emit({ type: 'interaction', sceneId: session.sceneId, objectId: 'lamp', by: actor.id });
      },
    });
    ctx.carry.spawn({ id: 'box', texture: 'item-cribBox', x: 960, y: 800, scale: 0.6 });
    ctx.hud.toast('تجربة: حرّكوا الشخصيتين، نوّروا الأباجورة، وشيلوا الكرتونة', 'info', 4200);
  }

  update(): void {}
}
