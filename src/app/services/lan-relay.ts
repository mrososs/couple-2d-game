import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';

export interface LanAddress {
  readonly name: string;
  readonly address: string;
}

/** A room another phone on this network is advertising (Android NSD / mDNS). */
export interface LanRoomAd {
  /** The advertised service name, unique per room. */
  readonly id: string;
  /** Who is hosting, as the host's app named it. */
  readonly name: string;
  readonly host: string;
  readonly port: number;
}

export interface NativeSubscription {
  remove(): void;
}

/** What modules/lan-relay declares natively (Kotlin), written out for TypeScript. */
export interface NativeLanRelay {
  /** Starts the room relay; the host key is the host app's own credential (room.ts). */
  start(port: number): Promise<{ port: number; addresses: LanAddress[]; hostKey: string }>;
  stop(): Promise<void>;
  isRunning(): boolean;
  /** This phone's addresses on Wi-Fi or its own hotspot; never mobile data or a VPN. */
  localAddresses(): LanAddress[];
  advertise(name: string, port: number): void;
  stopAdvertising(): void;
  startDiscovery(): void;
  stopDiscovery(): void;
  addListener(event: 'onService', listener: (event: LanRoomAd) => void): NativeSubscription;
  addListener(event: 'onServiceLost', listener: (event: { id: string }) => void): NativeSubscription;
}

/**
 * The host phone's room relay on the local network (modules/lan-relay), and finding rooms on it.
 * Absent in the browser build and in tests, where `available` is false and the lobby uses the
 * development relay (scripts/lan-relay.ts).
 */
@Injectable({ providedIn: 'root' })
export class LanRelay {
  /** The native module, or null where it is not in the build. Overridden in tests. */
  static readonly NATIVE = new InjectionToken<NativeLanRelay | null>('LanRelay.native', {
    // Required lazily: `expo` cannot load in Node or in a browser build.
    factory: () => {
      if (typeof require !== 'function') return null;
      try {
        // A lazy require, as NG Native's module guide prescribes: a static import of 'expo'
        // would fail every test and the browser build.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const expo = require('expo') as { requireOptionalNativeModule?: <T>(name: string) => T | null };
        return expo?.requireOptionalNativeModule?.<NativeLanRelay>('LanRelay') ?? null;
      } catch {
        return null;
      }
    },
  });

  private readonly native = inject(LanRelay.NATIVE);
  readonly available = !!this.native;
  /** Rooms found on this network while discovery runs. */
  readonly rooms = signal<readonly LanRoomAd[]>([]);
  private discoverers = 0;

  constructor() {
    const found = this.native?.addListener('onService', (room) => {
      this.rooms.update((list) => [...list.filter((r) => r.id !== room.id), room]);
    });
    const lost = this.native?.addListener('onServiceLost', ({ id }) => {
      this.rooms.update((list) => list.filter((r) => r.id !== id));
    });
    inject(DestroyRef).onDestroy(() => {
      found?.remove();
      lost?.remove();
      this.native?.stopDiscovery();
    });
  }

  /** This phone's address on the local network (Wi-Fi or hotspot), or null without one. */
  localAddress(): string | null {
    try {
      return this.native?.localAddresses()[0]?.address ?? null;
    } catch {
      return null;
    }
  }

  async start(port: number): Promise<{ address: string | null; hostKey: string }> {
    if (!this.native) throw new Error('LanRelay is not in this build');
    const { addresses, hostKey } = await this.native.start(port);
    return { address: addresses[0]?.address ?? null, hostKey };
  }

  async stop(): Promise<void> {
    this.stopAdvertising();
    await this.native?.stop();
  }

  /** Lets phones on this network find the room by name, without typing an address. */
  advertise(name: string, port: number): void {
    try {
      this.native?.advertise(name, port);
    } catch {
      // Discovery is a convenience: the room code still works without it.
    }
  }

  stopAdvertising(): void {
    try {
      this.native?.stopAdvertising();
    } catch {
      // Nothing was advertised.
    }
  }

  /** Looks for rooms until the returned function is called. */
  discover(): () => void {
    if (!this.native) return () => {};
    if (this.discoverers++ === 0) {
      this.rooms.set([]);
      try {
        this.native.startDiscovery();
      } catch {
        // No discovery on this network; the room code still works.
      }
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--this.discoverers === 0) {
        try {
          this.native?.stopDiscovery();
        } catch {
          // Already stopped.
        }
      }
    };
  }
}
