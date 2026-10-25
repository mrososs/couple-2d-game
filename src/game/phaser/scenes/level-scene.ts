import Phaser from 'phaser';
import type { CharacterId, GameCommand, LevelResult } from '../../bridge/protocol.ts';
import { ObjectiveManager } from '../../domain/objectives.ts';
import { buildMap, solidRects, TILE, type TileMap } from '../../domain/tile-map.ts';
import { ensureTexture } from '../art/texture-factory.ts';
import { PROPS } from '../art/props.ts';
import { createController } from '../levels/index.ts';
import type { LevelContext, LevelController } from '../levels/level-controller.ts';
import { COLORS, PLAYER_COLOR, servicesOf } from '../services.ts';
import { HostNet } from '../../net/host-net.ts';
import { CarrySystem } from '../systems/carry.ts';
import { JointCarry } from '../systems/cooperation.ts';
import { Feedback } from '../systems/feedback.ts';
import { InputHub, type Intent } from '../systems/input-hub.ts';
import { InteractionSystem } from '../systems/interaction.ts';
import { Player } from '../systems/player.ts';
import { ensureCharacter } from './boot-scene.ts';
import type { HudScene } from './hud-scene.ts';

/**
 * LevelManager's scene: builds whatever world the current level declares - floor plan, walls,
 * furniture, the two characters - wires the shared systems together, and runs the frame loop.
 * The level's own rules come from its controller, so this scene never knows which level it is.
 */
export class LevelScene extends Phaser.Scene {
  private controller!: LevelController;
  private players!: Record<CharacterId, Player>;
  private hub!: InputHub;
  private interaction!: InteractionSystem;
  private carry!: CarrySystem;
  private joint!: JointCarry;
  private feedback!: Feedback;
  private hud!: HudScene;
  private map!: TileMap;
  private camTarget!: Phaser.GameObjects.Zone;
  private startedAt = 0;
  private started = false;
  private hostNet?: HostNet;
  private finished = false;
  private perfClock = 0;
  private readonly intents = new Map<CharacterId, Intent>();

  constructor() {
    super('level');
  }

  create(): void {
    const services = servicesOf(this);
    const { session } = services;
    this.finished = false;
    this.started = false;
    this.controller = createController(session.sceneId);
    const { setup } = this.controller;

    // Floor plan and walls.
    this.map = buildMap(setup.map);
    const bgKey = `bg-${setup.mapKey}`;
    ensureTexture(this, bgKey, session);
    this.add.image(0, 0, bgKey).setOrigin(0).setDepth(-10000);
    const worldW = this.map.cols * TILE;
    const worldH = this.map.rows * TILE;
    this.physics.world.setBounds(0, 0, worldW, worldH);
    const solids = this.physics.add.staticGroup();
    for (const r of solidRects(this.map)) {
      const zone = this.add.zone(r.x * TILE + (r.w * TILE) / 2, r.y * TILE + (r.h * TILE) / 2, r.w * TILE, r.h * TILE);
      solids.add(zone);
    }

    // Furniture.
    const decor = new Map<string, Phaser.GameObjects.Image[]>();
    for (const placement of setup.decor) {
      const art = PROPS[placement.kind];
      const image = this.add.image(placement.x, placement.y, `prop-${placement.kind}`).setOrigin(0.5, 1).setFlipX(!!placement.flipX);
      image.setDepth(art.flat ? -5000 + placement.y : art.wall ? -4000 + placement.y : placement.y);
      if (art.flat) image.setOrigin(0.5, 0.5);
      if (art.body) {
        const zone = this.add.zone(placement.x, placement.y - art.body.h / 2, art.body.w, art.body.h);
        solids.add(zone);
      }
      decor.set(placement.kind, [...(decor.get(placement.kind) ?? []), image]);
    }
    const addSolid = (x: number, y: number, w: number, h: number) => {
      const zone = this.add.zone(x, y, w, h);
      solids.add(zone);
      return zone;
    };

    // Characters. With two phones this one controls only its own player; the other player's
    // controls arrive over the network.
    const net = session.net;
    this.hub = new InputHub(this, net ? net.me : session.lead, { single: !!net });
    const keyOf = (id: CharacterId) => ensureCharacter(this, id, session.outfits[id]);
    const step = () => services.sfx.play('step');
    this.players = {
      wife: new Player(this, 'wife', session.names.wife, keyOf('wife'), setup.spawns.wife.x, setup.spawns.wife.y, step),
      husband: new Player(this, 'husband', session.names.husband, keyOf('husband'), setup.spawns.husband.x, setup.spawns.husband.y, step),
    };
    const playerList = () => [this.players.wife, this.players.husband];
    for (const p of playerList()) this.physics.add.collider(p.sprite, solids);

    // Systems.
    this.feedback = new Feedback(this, services.sfx, () => servicesOf(this).settings.reducedMotion);
    this.interaction = new InteractionSystem(this, (actor) => {
      if (this.carry.heldBy(actor.id)) {
        if (this.carry.drop(actor)) {
          services.sfx.play('place');
          services.haptic('light', actor.id);
        }
      }
    });
    const hooks = this.controller.carryHooks ?? {};
    this.carry = new CarrySystem(this, this.interaction, playerList, {
      ...hooks,
      onPickUp: (actor, item) => {
        services.sfx.play('pickup');
        services.haptic('light', actor.id);
        hooks.onPickUp?.(actor, item);
      },
    });
    // Feel for the shared moments of carrying something heavy, on each phone it concerns.
    const jointHooks = this.controller.jointHooks;
    this.joint = new JointCarry(
      this,
      this.interaction,
      (id) => this.players[id],
      {
        ...jointHooks,
        onLift: (thing) => {
          services.haptic('medium', thing.minHolders === 1 ? thing.holders[0] : 'both');
          jointHooks.onLift?.(thing);
        },
        onAskHelp: (thing, asker) => {
          // The partner's phone buzzes: someone needs a hand.
          services.vibrate(asker.id === 'wife' ? 'husband' : 'wife');
          jointHooks.onAskHelp?.(thing, asker);
        },
      },
      (id) => !this.carry.heldBy(id),
    );
    const objectives = new ObjectiveManager(this.controller.content?.objectives ?? []);

    // HUD.
    this.hud = this.scene.get('hud') as HudScene;
    const ctx: LevelContext = {
      scene: this,
      services,
      hud: this.hud,
      map: this.map,
      players: this.players,
      hub: this.hub,
      interaction: this.interaction,
      carry: this.carry,
      joint: this.joint,
      feedback: this.feedback,
      objectives,
      solids,
      decor,
      elapsed: () => (this.time.now - this.startedAt) / 1000,
      complete: (result) => this.finish(result),
      addSolid,
    };
    this.hud.whenReady(() => {
      this.hud.attach(
        this.hub,
        { wife: `portrait-${keyOf('wife')}`, husband: `portrait-${keyOf('husband')}` },
        { wife: session.names.wife, husband: session.names.husband },
        !!net,
      );
      if (net?.role === 'host') {
        this.hostNet = new HostNet(this, this.hud, services, net, this.hub, this.players, this.interaction, this.joint, (kind) => this.command({ seq: 0, kind }));
      }
      const content = this.controller.content;
      this.hud.setLevelTitle(content ? `${content.number}. ${content.title}` : 'تجربة التكامل');
      objectives.onChange((list) => {
        this.hud.setObjectives(list);
        const progress = objectives.progress();
        const current = objectives.current();
        services.emit({ type: 'objective', sceneId: session.sceneId, done: progress.done, total: progress.total, text: current?.text ?? '' });
      });
      this.hud.setObjectives(objectives.list());
      if (content) this.hud.showIntro(content.title, content.intro, content.number);

      // The level's own rules start once the HUD they talk to is there.
      this.controller.start(ctx);
      // Furniture the level added (heavy things) collides with walls, other furniture and people.
      const things = this.joint.all().map((t) => t.image);
      for (const thing of things) {
        this.physics.add.collider(thing, solids);
        for (const p of playerList()) this.physics.add.collider(p.sprite, thing);
      }
      if (things.length > 1) this.physics.add.collider(things, things);
      this.started = true;
    });
    this.interaction.onPrompt((id, prompt) => {
      if (id === this.hub.active) this.hud.setPrompt(prompt);
    });
    this.hub.onSwap((active) => {
      this.hud.setPrompt(this.interaction.focusOf(active)?.prompt(this.players[active]) ?? null);
      for (const p of playerList()) p.setActive(p.id === active);
      this.feedback.say(this.players[active], `دوري! 👋`, 1000, PLAYER_COLOR[active]);
      services.sfx.play('click');
    });
    // With two phones each player is always "active" on their own phone, so both rings show.
    for (const p of playerList()) p.setActive(!!net || p.id === this.hub.active);

    // Camera: follows the pair, zooming out a little when they move apart.
    this.camTarget = this.add.zone(0, 0, 1, 1);
    this.updateCameraTarget(true);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    cam.setBackgroundColor(COLORS.ink);
    cam.startFollow(this.camTarget, false, 0.09, 0.09);
    cam.setZoom(this.targetZoom());
    cam.fadeIn(350, 46, 36, 32);

    this.events.once('shutdown', () => this.teardown());
    this.startedAt = this.time.now;
    services.emit({
      type: 'ready',
      sceneId: session.sceneId,
      sessionId: session.sessionId,
      renderer: this.game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas',
      width: Math.round(this.scale.width),
      height: Math.round(this.scale.height),
    });
  }

  update(time: number, delta: number): void {
    if (!this.started) return;
    this.hostNet?.update(delta);
    if (this.finished) {
      for (const p of Object.values(this.players)) p.update(delta);
      this.feedback.update();
      return;
    }
    this.hub.enabled = !this.hud.introOpen;
    this.hub.beginFrame();
    for (const id of ['wife', 'husband'] as const) this.intents.set(id, this.hub.intent(id));
    for (const p of Object.values(this.players)) p.move(this.intents.get(p.id)!);
    this.interaction.update(Object.values(this.players), this.intents);
    this.joint.update(this.intents);
    this.carry.update(time);
    this.controller.update(time, delta);
    for (const p of Object.values(this.players)) p.update(delta);
    this.feedback.update();
    this.updateCameraTarget(false);
    this.updatePartnerArrow();

    const { session } = servicesOf(this);
    this.perfClock += delta;
    if (this.perfClock > 1000) {
      this.perfClock = 0;
      this.hud.setFps(this.game.loop.actualFps);
      if (session.devMode && Math.floor(time / 1000) % 5 === 0) servicesOf(this).emit({ type: 'perf', fps: Math.round(this.game.loop.actualFps) });
    }
  }

  command(command: GameCommand): void {
    const services = servicesOf(this);
    if (command.kind === 'pause' && !this.scene.isPaused()) {
      this.scene.pause();
      this.hud.setPaused(true);
      this.hostNet?.paused(true);
      services.emit({ type: 'paused' });
    } else if (command.kind === 'resume' && this.scene.isPaused()) {
      this.scene.resume();
      this.hud.setPaused(false);
      this.hostNet?.paused(false);
      services.emit({ type: 'resumed' });
    } else if (command.kind === 'restart') {
      this.hud.setPaused(false);
      this.scene.restart();
    }
  }

  private finish(result: Omit<LevelResult, 'durationSec' | 'levelId'>): void {
    if (this.finished) return;
    this.finished = true;
    const services = servicesOf(this);
    const levelId = this.controller.content?.id;
    for (const p of Object.values(this.players)) {
      p.stop();
      p.react('cheer', 4000);
    }
    services.sfx.play('fanfare');
    services.haptic('success', 'both');
    const mid = this.midpoint();
    this.feedback.celebrate(mid.x, mid.y - 40);
    this.time.delayedCall(500, () => this.feedback.celebrate(mid.x - 80, mid.y - 60));
    this.time.delayedCall(900, () => this.feedback.celebrate(mid.x + 80, mid.y - 60));
    this.hud.toast('برافو عليكم! 🎉', 'good', 2400);
    if (!levelId) return;
    const durationSec = Math.round(this.elapsed());
    this.time.delayedCall(2200, () => {
      const complete = { ...result, levelId, durationSec };
      // Both phones record the level: the guest's app hears it through the host.
      this.hostNet?.complete(complete);
      services.emit({ type: 'complete', result: complete });
    });
  }

  private elapsed(): number {
    return (this.time.now - this.startedAt) / 1000;
  }

  private midpoint(): { x: number; y: number } {
    const { wife, husband } = this.players;
    return { x: (wife.x + husband.x) / 2, y: (wife.y + husband.y) / 2 };
  }

  private targetZoom(): number {
    const cam = this.cameras.main;
    const { wife, husband } = this.players;
    const spanX = Math.abs(wife.x - husband.x) + 520;
    const spanY = Math.abs(wife.y - husband.y) + 380;
    const minZoom = Math.max(cam.width / (this.map.cols * TILE), cam.height / (this.map.rows * TILE));
    return Phaser.Math.Clamp(Math.min(cam.width / spanX, cam.height / spanY), Math.max(minZoom, 0.55), 1.05);
  }

  private updateCameraTarget(snap: boolean): void {
    const { wife, husband } = this.players;
    const active = this.players[this.hub.active];
    // Weighted towards the character the touch controls drive, so they never walk off screen.
    const mx = (wife.x + husband.x) / 2;
    const my = (wife.y + husband.y) / 2;
    const x = mx * 0.6 + active.x * 0.4;
    const y = my * 0.6 + active.y * 0.4 - 30;
    this.camTarget.setPosition(x, y);
    const cam = this.cameras.main;
    const zoom = this.targetZoom();
    cam.setZoom(snap ? zoom : cam.zoom + (zoom - cam.zoom) * 0.05);
  }

  private updatePartnerArrow(): void {
    const cam = this.cameras.main;
    const partnerId: CharacterId = this.hub.active === 'wife' ? 'husband' : 'wife';
    const partner = this.players[partnerId];
    const view = cam.worldView;
    if (view.contains(partner.x, partner.y - 40)) {
      this.hud.showPartnerArrow(null, PLAYER_COLOR[partnerId]);
      return;
    }
    const cx = view.centerX;
    const cy = view.centerY;
    const angle = Math.atan2(partner.y - cy, partner.x - cx);
    const w = this.scale.width;
    const h = this.scale.height;
    const x = Phaser.Math.Clamp(w / 2 + Math.cos(angle) * (w / 2 - 50), 50, w - 50);
    const y = Phaser.Math.Clamp(h / 2 + Math.sin(angle) * (h / 2 - 50), 120, h - 50);
    this.hud.showPartnerArrow(angle, PLAYER_COLOR[partnerId], x, y);
  }

  private teardown(): void {
    this.hostNet?.destroy();
    this.hostNet = undefined;
    this.controller.dispose?.();
    this.joint.destroy();
    this.carry.destroy();
    this.interaction.destroy();
    this.feedback.destroy();
    for (const p of Object.values(this.players)) p.destroy();
  }
}
