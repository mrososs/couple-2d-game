import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';

export interface LanAddress {
  readonly name: string;
  readonly address: string;
}

/** What modules/lan-relay declares natively (Kotlin), written out for TypeScript. */
export interface NativeLanRelay {
  start(port: number): Promise<{ port: number; addresses: LanAddress[] }>;
  stop(): Promise<void>;
  isRunning(): boolean;
  localAddresses(): LanAddress[];
  addListener(event: 'onPeers', listener: (event: { count: number }) => void): { remove(): void };
}

/**
 * The host phone's WebSocket relay on the local network (modules/lan-relay). Absent in the
 * browser build and in tests, where `available` is false and the lobby uses a development relay.
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
  /** Clients connected to the relay, the host's own included. */
  readonly peers = signal(0);
  readonly available = !!this.native;

  constructor() {
    const subscription = this.native?.addListener('onPeers', ({ count }) => this.peers.set(count));
    inject(DestroyRef).onDestroy(() => subscription?.remove());
  }

  /** This phone's address on the local network (Wi-Fi or hotspot), or null without one. */
  localAddress(): string | null {
    return this.native?.localAddresses()[0]?.address ?? null;
  }

  async start(port: number): Promise<string | null> {
    if (!this.native) throw new Error('LanRelay is not in this build');
    const { addresses } = await this.native.start(port);
    return addresses[0]?.address ?? null;
  }

  async stop(): Promise<void> {
    await this.native?.stop();
    this.peers.set(0);
  }
}
