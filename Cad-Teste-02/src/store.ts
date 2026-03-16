// src/store.ts — Histórico de transformações CAD (zero dependências externas)

export type Matrix16 = number[];

export const IDENTITY: Matrix16 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

type Snapshot = Record<number, Matrix16>;

/** Stack de undo/redo para matrizes de transformação. */
class HistoryStore {
  private past:    Snapshot[] = [];
  private future:  Snapshot[] = [];
  private current: Snapshot   = {};

  getMatrices(): Readonly<Snapshot> {
    return this.current;
  }

  setMatrix(shapeId: number, m: Matrix16): void {
    this.past.push({ ...this.current });
    this.future = [];                         // novo commit limpa o redo
    this.current = { ...this.current, [shapeId]: m };
  }

  removeShape(shapeId: number): void {
    this.past.push({ ...this.current });
    this.future = [];
    const next = { ...this.current };
    delete next[shapeId];
    this.current = next;
  }

  /** Volta um passo. Devolve o snapshot anterior ou null se não houver. */
  undo(): Readonly<Snapshot> | null {
    if (this.past.length === 0) return null;
    this.future.push({ ...this.current });
    this.current = this.past.pop()!;
    return this.current;
  }

  /** Avança um passo. Devolve o snapshot seguinte ou null se não houver. */
  redo(): Readonly<Snapshot> | null {
    if (this.future.length === 0) return null;
    this.past.push({ ...this.current });
    this.current = this.future.pop()!;
    return this.current;
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }
}

export const cadStore = new HistoryStore();
