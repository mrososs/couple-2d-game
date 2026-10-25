import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { createGameClient, type AuthStorage, type GameClient, type OnlineConfig } from '../../online/client.ts';
import { OnlineError, toOnlineError, type OnlineErrorKey } from '../../online/protocol.ts';
import { saveProfile } from '../../online/rooms-api.ts';
import { Progress } from './progress.ts';

/**
 * The Supabase project to play online with, or null when this build has none configured
 * (EXPO_PUBLIC_SUPABASE_* unset): online play is then off and everything else works as before.
 */
export const ONLINE_CONFIG = new InjectionToken<OnlineConfig | null>('bwbt.onlineConfig', { factory: () => null });

/**
 * Where the player's session is kept: AsyncStorage on a phone (src/main.ts), the page's
 * localStorage in the browser host. Null leaves it to Supabase's default.
 */
export const ONLINE_AUTH_STORAGE = new InjectionToken<AuthStorage | null>('bwbt.onlineAuthStorage', { factory: () => null });

/** The app's one Supabase client, made on first use. */
@Injectable({ providedIn: 'root' })
export class Online {
  private readonly config = inject(ONLINE_CONFIG);
  private readonly storage = inject(ONLINE_AUTH_STORAGE);
  private instance: GameClient | null = null;

  get available(): boolean {
    return this.config !== null;
  }

  get client(): GameClient {
    if (!this.config) throw new OnlineError('network', 'Online play is not configured in this build');
    this.instance ??= createGameClient(this.config, { storage: this.storage ?? undefined });
    return this.instance;
  }
}

/**
 * Who this phone is to the server. Players never make an account: the first time they go online
 * they are signed in anonymously, and Supabase keeps and refreshes that session from then on.
 * Their names and look go to their profile, which is what their partner's phone shows.
 */
@Injectable({ providedIn: 'root' })
export class OnlineSession {
  private readonly online = inject(Online);
  private readonly progress = inject(Progress);
  private watching = false;

  readonly userId = signal<string | null>(null);
  readonly error = signal<OnlineErrorKey | null>(null);
  readonly signedIn = computed(() => this.userId() !== null);

  /** Signs in if needed and saves the profile; returns the player's id. */
  async ensureSignedIn(): Promise<string> {
    const auth = this.online.client.auth;
    this.watch();
    try {
      let { data: { session } } = await auth.getSession();
      if (!session) {
        const { data, error } = await auth.signInAnonymously();
        if (error || !data.session) throw toOnlineError(error);
        session = data.session;
      }
      this.userId.set(session.user.id);
      await this.saveProfile();
      this.error.set(null);
      return session.user.id;
    } catch (e) {
      const error = e instanceof OnlineError ? e : toOnlineError({ message: (e as Error)?.message });
      this.error.set(error.key);
      throw error;
    }
  }

  /** Mirrors the names and outfit chosen on the characters screen into the online profile. */
  async saveProfile(): Promise<void> {
    const userId = this.userId();
    if (!userId) return;
    const profile = this.progress.profile();
    await saveProfile(this.online.client, userId, {
      displayName: profile.names[profile.lead],
      character: profile.lead,
      outfit: profile.outfits[profile.lead],
    });
  }

  private watch(): void {
    if (this.watching) return;
    this.watching = true;
    this.online.client.auth.onAuthStateChange((_event, session) => this.userId.set(session?.user.id ?? null));
  }
}
