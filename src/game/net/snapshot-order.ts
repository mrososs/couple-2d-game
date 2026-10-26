/**
 * The guest's rule for snapshots. A full snapshot always applies and starts a sequence; a delta
 * applies only on top of the one numbered just before it, in the same run. Anything older is
 * dropped, and a gap (a snapshot lost while the connection blinked) stops deltas until the host
 * has sent a full one again - drawing a delta over the wrong picture leaves things where they are
 * not.
 */
export type SnapshotVerdict = 'apply' | 'drop' | 'resync';

export class SnapshotOrder {
  private run: string | null = null;
  private last = 0;
  private synced = false;

  /** Whether the picture is complete and current (false until the first full snapshot). */
  get isSynced(): boolean {
    return this.synced;
  }

  get currentRun(): string | null {
    return this.run;
  }

  accept(run: string, n: number, full: boolean): SnapshotVerdict {
    if (full) {
      if (this.run === run && n <= this.last) return 'drop';
      this.run = run;
      this.last = n;
      this.synced = true;
      return 'apply';
    }
    if (!this.synced || run !== this.run) {
      this.synced = false;
      return 'resync';
    }
    if (n <= this.last) return 'drop';
    if (n !== this.last + 1) {
      this.synced = false;
      return 'resync';
    }
    this.last = n;
    return 'apply';
  }

  /** The connection dropped: whatever comes next must start with a full snapshot. */
  invalidate(): void {
    this.synced = false;
  }
}
