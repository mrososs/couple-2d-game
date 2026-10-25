import type { GameSettings } from '../../bridge/protocol.ts';

/**
 * Small synthesized sound effects. Generated with WebAudio rather than loaded from files, so the
 * game page has no audio assets to ship, and created lazily on the first touch because mobile web
 * views only start audio from a user gesture.
 */

export type SfxName = 'pickup' | 'place' | 'step' | 'success' | 'soft' | 'error' | 'chime' | 'pop' | 'coin' | 'fanfare' | 'click';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private volume = 0.7;

  apply(settings: GameSettings): void {
    this.enabled = settings.sound;
    this.volume = settings.volume;
    if (this.master) this.master.gain.value = this.enabled ? this.volume * 0.6 : 0;
  }

  /** Called from a pointer or key handler: the first gesture is what lets audio start. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume * 0.6 : 0;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  play(name: SfxName): void {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'pickup':
        this.tone(520, 0.08, 'triangle', t, 0.5, 780);
        break;
      case 'place':
        this.tone(330, 0.1, 'sine', t, 0.6, 220);
        this.noise(t, 0.05, 0.15);
        break;
      case 'step':
        this.noise(t, 0.03, 0.04);
        break;
      case 'success':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', t + i * 0.08, 0.45));
        break;
      case 'chime':
        [880, 1175].forEach((f, i) => this.tone(f, 0.25, 'sine', t + i * 0.06, 0.3));
        break;
      case 'soft':
        this.tone(392, 0.18, 'sine', t, 0.35, 349);
        break;
      case 'error':
        this.tone(220, 0.16, 'triangle', t, 0.35, 196);
        break;
      case 'pop':
        this.tone(660, 0.05, 'square', t, 0.15, 990);
        break;
      case 'coin':
        this.tone(988, 0.06, 'square', t, 0.18);
        this.tone(1319, 0.14, 'square', t + 0.06, 0.18);
        break;
      case 'click':
        this.tone(1200, 0.02, 'square', t, 0.12);
        break;
      case 'fanfare':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'triangle', t + i * 0.11, 0.4));
        break;
    }
  }

  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  private tone(freq: number, dur: number, type: OscillatorType, start: number, gain: number, endFreq?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(amp).connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  private noise(start: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.buffer = buffer;
    src.connect(amp).connect(this.master!);
    src.start(start);
  }
}
