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

/** The other phone's controls, as HostNet passes them on after checking them (net/protocol.ts). */
export interface RemoteInput {
  /** The guest's input epoch; press counters start from zero in each. */
  readonly ep: string;
  readonly seq: number;
  readonly x: number;
  readonly y: number;
  /** Presses since the epoch began. */
  readonly ia: number;
  readonly ro: number;
}

/** Where an input epoch's counters stood when last read. */
interface EpochCounters {
  seq: number;
  interacts: number;
  rotates: number;
}

interface RemoteControl {
  x: number;
  y: number;
  /**
   * Counters per epoch, the most recent few: a late message from an earlier epoch picks up where
   * that epoch left off instead of resetting anything (which would replay presses).
   */
  epochs: Map<string, EpochCounters>;
  /** Presses waiting for a frame of their own. */
  pendingInteracts: number;
  pendingRotates: number;
}

/** Presses one message may add, and presses that may wait: a burst beyond is not a person. */
const MAX_NEW_PRESSES = 4;
const MAX_PENDING_PRESSES = 6;
const EPOCHS_KEPT = 4;

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

  /**
   * Drives a character from the other phone. Presses arrive as running counts per epoch: a new
   * epoch counts from zero (so its very first press is kept), a message older than the last one
   * read changes nothing, and every press gets a frame of its own - two presses that arrive
   * between frames are two interactions, not one. With `countPresses` false (the guest is still
   * looking at a finished run) only the stick is taken.
   */
  setRemote(id: CharacterId, input: RemoteInput, countPresses = true): void {
    let control = this.remote.get(id);
    if (!control) {
      control = { x: 0, y: 0, epochs: new Map(), pendingInteracts: 0, pendingRotates: 0 };
      this.remote.set(id, control);
    }
    if (!countPresses) {
      // Aimed at an earlier run: the stick still says where the player wants to go, nothing more.
      this.setStickOf(control, input.x, input.y);
      return;
    }
    let epoch = control.epochs.get(input.ep);
    if (!epoch) {
      epoch = { seq: -1, interacts: 0, rotates: 0 };
      control.epochs.set(input.ep, epoch);
      if (control.epochs.size > EPOCHS_KEPT) control.epochs.delete(control.epochs.keys().next().value!);
    }
    if (input.seq <= epoch.seq) return;
    epoch.seq = input.seq;
    this.setStickOf(control, input.x, input.y);
    const newInteracts = Math.max(0, Math.min(MAX_NEW_PRESSES, input.ia - epoch.interacts));
    const newRotates = Math.max(0, Math.min(MAX_NEW_PRESSES, input.ro - epoch.rotates));
    epoch.interacts = Math.max(epoch.interacts, input.ia);
    epoch.rotates = Math.max(epoch.rotates, input.ro);
    control.pendingInteracts = Math.min(MAX_PENDING_PRESSES, control.pendingInteracts + newInteracts);
    control.pendingRotates = Math.min(MAX_PENDING_PRESSES, control.pendingRotates + newRotates);
  }

  private setStickOf(control: RemoteControl, x: number, y: number): void {
    const len = Math.hypot(x, y);
    const ok = Number.isFinite(len);
    control.x = !ok ? 0 : len > 1 ? x / len : x;
    control.y = !ok ? 0 : len > 1 ? y / len : y;
  }

  /** The other phone went quiet: its character stops rather than walking on. */
  releaseRemote(id: CharacterId): void {
    const control = this.remote.get(id);
    if (control) {
      control.x = 0;
      control.y = 0;
    }
  }

  /** Whether a character is driven from the other phone (and has sent anything yet). */
  isRemote(id: CharacterId): boolean {
    return this.remote.has(id);
  }

  /** Reads the devices once at the start of a frame; `intent()` then answers from that snapshot. */
  beginFrame(): void {
    if (this.swapKey && Phaser.Input.Keyboard.JustDown(this.swapKey)) this.swap();
    for (const id of ['wife', 'husband'] as const) {
      const remote = this.remote.get(id);
      if (!this.enabled) {
        // Presses made while the controls are off (the level intro) do not fire afterwards.
        if (remote) remote.pendingInteracts = remote.pendingRotates = 0;
        this.frame.set(id, IDLE);
        continue;
      }
      if (remote) {
        const intent = { x: remote.x, y: remote.y, interact: remote.pendingInteracts > 0, rotate: remote.pendingRotates > 0 };
        if (intent.interact) remote.pendingInteracts--;
        if (intent.rotate) remote.pendingRotates--;
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
