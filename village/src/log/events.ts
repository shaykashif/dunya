import { StreamHasher } from "./hash.ts";

export interface SimEvent {
  seq: number;
  tick: number;
  type: string;
  actors: number[];
  data: Record<string, unknown>;
}

export type EventSink = (event: SimEvent, line: string) => void;

/**
 * Append-only event log. Every event is serialized to one JSON line, folded
 * into the stream hash, optionally retained in memory and passed to sinks
 * (file writers, streaming checkers).
 */
export class EventLog {
  private seqNo = 0;
  private readonly hasher = new StreamHasher();
  private readonly sinks: EventSink[] = [];
  readonly retained: SimEvent[] | null;
  readonly counts: Record<string, number> = {};

  constructor(options: { retain?: boolean } = {}) {
    this.retained = options.retain ? [] : null;
  }

  addSink(sink: EventSink): void {
    this.sinks.push(sink);
  }

  emit(tick: number, type: string, actors: readonly number[], data: Record<string, unknown>): SimEvent {
    const event: SimEvent = { seq: this.seqNo++, tick, type, actors: actors.slice(), data };
    const line = JSON.stringify(event);
    this.hasher.update(line);
    this.hasher.update("\n");
    this.counts[type] = (this.counts[type] ?? 0) + 1;
    if (this.retained) this.retained.push(event);
    for (const sink of this.sinks) sink(event, line);
    return event;
  }

  get size(): number {
    return this.seqNo;
  }

  count(type: string): number {
    return this.counts[type] ?? 0;
  }

  hash(): string {
    return this.hasher.digest();
  }
}

/** Round for logging so event lines stay short and stable. */
export function r3(x: number): number {
  const v = Math.round(x * 1000) / 1000;
  return v === 0 ? 0 : v;
}
