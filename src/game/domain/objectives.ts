/**
 * ObjectiveManager: the ordered goals of a level and which are done. Levels reveal objectives as
 * the story moves on (the phone rings in level 1, the checkout opens in level 2), so an objective
 * can start hidden. Pure state: the HUD draws it and the bridge reports it.
 */

export interface ObjectiveDef {
  readonly id: string;
  /** Short Arabic line, shown in the HUD. */
  readonly text: string;
  readonly hidden?: boolean;
}

export interface ObjectiveState {
  readonly id: string;
  readonly text: string;
  readonly visible: boolean;
  readonly done: boolean;
}

export class ObjectiveManager {
  private readonly states: Map<string, { def: ObjectiveDef; visible: boolean; done: boolean }>;
  private readonly listeners = new Set<(objectives: readonly ObjectiveState[]) => void>();

  constructor(defs: readonly ObjectiveDef[]) {
    this.states = new Map(defs.map((def) => [def.id, { def, visible: !def.hidden, done: false }]));
  }

  list(): ObjectiveState[] {
    return [...this.states.values()].map(({ def, visible, done }) => ({ id: def.id, text: def.text, visible, done }));
  }

  /** The first visible objective that is not done: what the player should do next. */
  current(): ObjectiveState | undefined {
    return this.list().find((o) => o.visible && !o.done);
  }

  isDone(id: string): boolean {
    return this.require(id).done;
  }

  reveal(id: string): void {
    const state = this.require(id);
    if (state.visible) return;
    state.visible = true;
    this.notify();
  }

  complete(id: string): boolean {
    const state = this.require(id);
    if (state.done) return false;
    state.visible = true;
    state.done = true;
    this.notify();
    return true;
  }

  /** Re-opens an objective, as when a placed card is taken back off the board. */
  reopen(id: string): void {
    const state = this.require(id);
    if (!state.done) return;
    state.done = false;
    this.notify();
  }

  progress(): { done: number; total: number } {
    const all = this.list();
    return { done: all.filter((o) => o.done).length, total: all.length };
  }

  allDone(): boolean {
    return this.list().every((o) => o.done);
  }

  onChange(listener: (objectives: readonly ObjectiveState[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private require(id: string) {
    const state = this.states.get(id);
    if (!state) throw new Error(`Unknown objective '${id}'`);
    return state;
  }

  private notify(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) listener(snapshot);
  }
}
