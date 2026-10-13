import type { ActionKind } from "../actions/types.ts";
import type { Person, SentenceKind } from "../world/types.ts";

export interface Norm {
  id: string;
  forbids: ActionKind;
  /** Ordered from mildest to harshest. */
  penaltyOptions: SentenceKind[];
  exemptions?: (actor: Person, victim: Person | null) => boolean;
}

/** Norms are data so villages can differ later. */
export const DEFAULT_NORMS: readonly Norm[] = [
  { id: "theft", forbids: "steal", penaltyOptions: ["restitution", "imprisonment", "exile"] },
  { id: "violence", forbids: "attack", penaltyOptions: ["restitution", "imprisonment", "exile", "execution"] },
];

export function normFor(kind: "theft" | "violence", norms: readonly Norm[] = DEFAULT_NORMS): Norm {
  const n = norms.find((x) => x.id === kind);
  if (!n) throw new Error(`no norm ${kind}`);
  return n;
}
