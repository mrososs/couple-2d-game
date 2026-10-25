import Phaser from 'phaser';
import type { CharacterId } from '../../bridge/protocol.ts';
import { arabic, COLORS, PLAYER_COLOR } from '../services.ts';
import type { Intent } from './input-hub.ts';
import type { Player } from './player.ts';

/**
 * InteractionSystem: what each character can reach, and what pressing interact does there.
 *
 * Every frame each character focuses the nearest thing in reach that has something to offer them
 * - a coloured chevron in their colour bounces over it with a one-word prompt - and a press acts
 * on that one thing. Things a character cannot use right now return no prompt and are skipped, so
 * a full pair of hands walks past a shelf to the trolley rather than getting stuck on it.
 */

export interface Interactable {
  readonly id: string;
  /** Where on the floor a character must stand near. */
  x: number;
  y: number;
  readonly radius: number;
  /** Height of the chevron above (x, y). */
  readonly indicatorHeight?: number;
  /** A one-word Arabic verb for this actor, or null when there is nothing to do here for them. */
  prompt(actor: Player): string | null;
  interact(actor: Player): void;
  /** Breaks ties: higher wins when two things are equally close. */
  readonly priority?: number;
  /** Pulses while focused. */
  readonly target?: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject;
}

interface Focus {
  readonly chevron: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  current: Interactable | null;
  tween?: Phaser.Tweens.Tween;
}

export class InteractionSystem {
  private readonly items = new Map<string, Interactable>();
  private readonly focus = new Map<CharacterId, Focus>();
  private readonly listeners = new Set<(id: CharacterId, prompt: string | null) => void>();

  constructor(
    private readonly scene: Phaser.Scene,
    /** Called when interact is pressed with nothing in reach: drop what is held, say. */
    private readonly fallback: (actor: Player) => void,
  ) {
    for (const id of ['wife', 'husband'] as const) {
      const chevron = scene.add.image(0, 0, `chevron-${id}`).setVisible(false).setDepth(100000);
      const label = arabic(scene, 0, 0, '', 17, COLORS.paper, {
        backgroundColor: PLAYER_COLOR[id],
        padding: { left: 8, right: 8, top: 4, bottom: 2 },
      })
        .setVisible(false)
        .setDepth(100001);
      this.focus.set(id, { chevron, label, current: null });
    }
  }

  add(item: Interactable): Interactable {
    this.items.set(item.id, item);
    return item;
  }

  remove(id: string): void {
    this.items.delete(id);
    for (const focus of this.focus.values()) if (focus.current?.id === id) this.clear(focus);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  /** Follow a character's focused prompt (the HUD labels the touch button with it). */
  onPrompt(listener: (id: CharacterId, prompt: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  focusOf(id: CharacterId): Interactable | null {
    return this.focus.get(id)?.current ?? null;
  }

  update(players: readonly Player[], intents: ReadonlyMap<CharacterId, Intent>): void {
    for (const player of players) {
      const focus = this.focus.get(player.id)!;
      const best = this.pick(player);
      const prompt = best?.prompt(player) ?? null;
      if (best !== focus.current) {
        this.clear(focus);
        focus.current = best;
        if (best?.target) {
          const target = best.target;
          const base = { x: target.scaleX, y: target.scaleY };
          focus.tween = this.scene.tweens.add({
            targets: target,
            scaleX: base.x * 1.05,
            scaleY: base.y * 1.05,
            duration: 360,
            yoyo: true,
            repeat: -1,
            onStop: () => target.setScale(base.x, base.y),
          });
        }
        for (const listener of this.listeners) listener(player.id, prompt);
      }
      if (best && prompt) {
        const ih = best.indicatorHeight ?? 70;
        // Two characters on one thing: nudge the chevrons apart so both stay visible.
        const other = [...this.focus.entries()].find(([id, f]) => id !== player.id && f.current === best);
        const dx = other ? (player.id === 'wife' ? 14 : -14) : 0;
        const bounce = Math.sin(this.scene.time.now / 160) * 4;
        focus.chevron.setVisible(true).setPosition(best.x + dx, best.y - ih + bounce);
        focus.label.setVisible(true).setText(prompt).setPosition(best.x + dx, best.y - ih - 28 - (other && player.id === 'husband' ? 30 : 0));
      }
      const intent = intents.get(player.id);
      if (intent?.interact) {
        if (best && prompt) {
          player.playInteract();
          const dx = best.x - player.x;
          const dy = best.y - player.y;
          if (!player.locked) player.face(dx, dy);
          best.interact(player);
        } else {
          this.fallback(player);
        }
      }
    }
  }

  private pick(player: Player): Interactable | null {
    let best: Interactable | null = null;
    let bestScore = Infinity;
    const fx = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[player.facing];
    for (const item of this.items.values()) {
      if (player.holding && item.id !== player.holding) continue;
      const dx = item.x - player.x;
      const dy = item.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > item.radius) continue;
      if (!item.prompt(player)) continue;
      // Things in front of the character win over things behind it at the same distance.
      const facing = dist > 0 ? (dx * fx[0] + dy * fx[1]) / dist : 1;
      const score = dist - facing * 18 - (item.priority ?? 0) * 30;
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }

  private clear(focus: Focus): void {
    focus.tween?.stop();
    focus.tween = undefined;
    focus.current = null;
    focus.chevron.setVisible(false);
    focus.label.setVisible(false);
  }

  destroy(): void {
    for (const focus of this.focus.values()) {
      this.clear(focus);
      focus.chevron.destroy();
      focus.label.destroy();
    }
    this.items.clear();
    this.listeners.clear();
  }
}
