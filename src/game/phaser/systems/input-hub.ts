import Phaser from 'phaser';
import type { CharacterId } from '../../bridge/protocol.ts';

/**
 * Turns every control scheme into one intent per character per frame.
 *
 * - Keyboard, for desktop and two people at one keyboard: the lead character on WASD + E (or
 *   Space) + R, the partner on the arrows + Enter (or K) + L. Tab swaps the touch target.
 * - Touch: one joystick and an interact button drive the active character; the swap button moves
 *   them to the partner, who keeps standing (on a switch, holding a box) while the other moves.
 */

export interface Intent {
  /** -1..1 each; length at most 1. */
  readonly x: number;
  readonly y: number;
  /** True on the frame the button went down. */
  readonly interact: boolean;
  readonly rotate: boolean;
}

const IDLE: Intent = { x: 0, y: 0, interact: false, rotate: false };

interface KeySet {
  up: Phaser.Input.Keyboard.Key[];
  down: Phaser.Input.Keyboard.Key[];
  left: Phaser.Input.Keyboard.Key[];
  right: Phaser.Input.Keyboard.Key[];
  interact: Phaser.Input.Keyboard.Key[];
  rotate: Phaser.Input.Keyboard.Key[];
}

export interface InputHubOptions {
  /**
   * One phone, one character (two-phone play): both key sets and the touch controls drive the
   * lead, and there is no swapping to the partner, whose controls are on the other phone.
   */
  readonly single?: boolean;
}

interface RemoteControl {
  x: number;
  y: number;
  interacts: number;
  rotates: number;
  seenInteracts: number;
  seenRotates: number;
}

export class InputHub {
  /** The character the touch controls drive. */
  active: CharacterId;
  readonly canSwap: boolean;
  private readonly keys = new Map<CharacterId, KeySet[]>();
  private readonly remote = new Map<CharacterId, RemoteControl>();
  private readonly frame = new Map<CharacterId, Intent>();
  private readonly touchStick = { x: 0, y: 0 };
  private touchInteract = false;
  private touchRotate = false;
  private swapKey?: Phaser.Input.Keyboard.Key;
  private readonly swapListeners = new Set<(active: CharacterId) => void>();
  enabled = true;

  constructor(
    scene: Phaser.Scene,
    readonly lead: CharacterId,
    options: InputHubOptions = {},
  ) {
    this.active = lead;
    this.canSwap = !options.single;
    const partner: CharacterId = lead === 'wife' ? 'husband' : 'wife';
    const kb = scene.input.keyboard;
    if (!kb) return;
    const K = Phaser.Input.Keyboard.KeyCodes;
    const add = (...codes: number[]) => codes.map((code) => kb.addKey(code, true, false));
    const first: KeySet = {
      up: add(K.W),
      down: add(K.S),
      left: add(K.A),
      right: add(K.D),
      interact: add(K.E, K.SPACE),
      rotate: add(K.R),
    };
    const second: KeySet = {
      up: add(K.UP),
      down: add(K.DOWN),
      left: add(K.LEFT),
      right: add(K.RIGHT),
      interact: add(K.ENTER, K.K),
      rotate: add(K.L),
    };
    if (options.single) {
      this.keys.set(lead, [first, second]);
    } else {
      this.keys.set(lead, [first]);
      this.keys.set(partner, [second]);
      this.swapKey = kb.addKey(K.TAB, true, false);
    }
  }

  /** Drives a character from the other phone. Presses arrive as running counts. */
  setRemote(id: CharacterId, x: number, y: number, interacts: number, rotates: number): void {
    const len = Math.hypot(x, y);
    const control = this.remote.get(id) ?? { x: 0, y: 0, interacts, rotates, seenInteracts: interacts, seenRotates: rotates };
    control.x = len > 1 ? x / len : x;
    control.y = len > 1 ? y / len : y;
    control.interacts = interacts;
    control.rotates = rotates;
    this.remote.set(id, control);
  }

  /** The other phone went quiet: its character stops rather than walking on. */
  releaseRemote(id: CharacterId): void {
    const control = this.remote.get(id);
    if (control) {
      control.x = 0;
      control.y = 0;
    }
  }

  /** Reads the devices once at the start of a frame; `intent()` then answers from that snapshot. */
  beginFrame(): void {
    if (this.swapKey && Phaser.Input.Keyboard.JustDown(this.swapKey)) this.swap();
    for (const id of ['wife', 'husband'] as const) {
      if (!this.enabled) {
        this.frame.set(id, IDLE);
        continue;
      }
      const remote = this.remote.get(id);
      if (remote) {
        const intent = {
          x: remote.x,
          y: remote.y,
          interact: remote.interacts > remote.seenInteracts,
          rotate: remote.rotates > remote.seenRotates,
        };
        remote.seenInteracts = remote.interacts;
        remote.seenRotates = remote.rotates;
        this.frame.set(id, intent);
        continue;
      }
      const sets = this.keys.get(id) ?? [];
      let x = 0;
      let y = 0;
      let interact = false;
      let rotate = false;
      for (const set of sets) {
        const down = (keys: Phaser.Input.Keyboard.Key[]) => keys.some((k) => k.isDown);
        x += (down(set.right) ? 1 : 0) - (down(set.left) ? 1 : 0);
        y += (down(set.down) ? 1 : 0) - (down(set.up) ? 1 : 0);
        interact = set.interact.some((k) => Phaser.Input.Keyboard.JustDown(k)) || interact;
        rotate = set.rotate.some((k) => Phaser.Input.Keyboard.JustDown(k)) || rotate;
      }
      if (id === this.active) {
        if (Math.abs(this.touchStick.x) + Math.abs(this.touchStick.y) > 0) {
          x = this.touchStick.x;
          y = this.touchStick.y;
        }
        interact ||= this.touchInteract;
        rotate ||= this.touchRotate;
      }
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      this.frame.set(id, { x, y, interact, rotate });
    }
    this.touchInteract = false;
    this.touchRotate = false;
  }

  intent(id: CharacterId): Intent {
    return this.frame.get(id) ?? IDLE;
  }

  setStick(x: number, y: number): void {
    this.touchStick.x = x;
    this.touchStick.y = y;
  }

  pressInteract(): void {
    this.touchInteract = true;
  }

  pressRotate(): void {
    this.touchRotate = true;
  }

  swap(): void {
    if (!this.canSwap) return;
    this.active = this.active === 'wife' ? 'husband' : 'wife';
    this.setStick(0, 0);
    for (const listener of this.swapListeners) listener(this.active);
  }

  onSwap(listener: (active: CharacterId) => void): () => void {
    this.swapListeners.add(listener);
    return () => this.swapListeners.delete(listener);
  }
}
