import type { Rng } from "../engine/rng.ts";
import type { SimEvent } from "../log/events.ts";
import type { World } from "../world/world.ts";
import type { HolderRef, ItemKind, NeedKind, Person, Point } from "../world/types.ts";

export type ActionKind =
  | "forage"
  | "eat"
  | "drink"
  | "sleep"
  | "idle"
  | "store_goods"
  | "gather_wood"
  | "tend_fire"
  | "repair_shelter"
  | "plant"
  | "harvest"
  | "give"
  | "request_food"
  | "socialize"
  | "comfort"
  | "steal"
  | "attack"
  | "examine"
  | "interview"
  | "accuse"
  | "testify"
  | "judge"
  | "punish"
  | "court"
  | "propose"
  | "break_up"
  | "elope"
  | "plot"
  | "stalk"
  | "raid"
  | "flee"
  | "chase"
  | "defend"
  | "tend_animals"
  | "hunt"
  | "slaughter"
  | "tend_children"
  | "wash"
  | "investigate"
  | "kidnap"
  | "hide"
  | "search"
  | "lie_in_wait"
  | "rescue"
  | "carry"
  | "tend_wounded"
  | "craft"
  | "masonry"
  | "patrol"
  | "intimidate"
  | "commission"
  | "haul"
  | "construct"
  | "quarry"
  | "pray"
  | "celebrate"
  | "wolf_hunt"
  | "seek_care"
  | "skin"
  | "sew"
  | "inquest"
  | "respond";

/** Expected changes the actor anticipates; the utility scorer weighs them. */
export interface Effects {
  food?: number;
  water?: number;
  warmth?: number;
  rest?: number;
  health?: number;
  companionship?: number;
  affection?: number;
  status?: number;
  comfort?: number;
  security?: number;
  provision?: number;
  justice?: number;
  duty?: number;
  relation?: number;
  romance?: number;
  grudge?: number;
  greed?: number;
  /** The pull of a mad compulsion; only the mad feel it. */
  frenzy?: number;
  /** How much the action would meet each personal need (to pray, to make things, ...). */
  focus?: Partial<Record<NeedKind, number>>;
}

export interface CandidateAction {
  kind: ActionKind;
  key: string;
  description: string;
  targetId?: number;
  buildingId?: number;
  householdId?: number;
  caseId?: number;
  hearingId?: number;
  sentenceId?: number;
  dest: Point | null;
  /** Walk to the target person's current position instead of a fixed tile. */
  follow?: boolean;
  /** How close to `dest` the person must stand (default: anywhere inside the same building, else 2 tiles). */
  reach?: number;
  plotId?: number;
  duration: number;
  travel: number;
  risk: number;
  norm?: boolean;
  continuous?: boolean;
  effects: Effects;
  obligationIds?: number[];
  item?: ItemKind;
  qty?: number;
  source?: HolderRef;
  motive?: string;
  option?: string;
}

export interface ResolveCtx {
  rng: Rng;
  /** Index the (first) responder chose, for actions that ask another person. */
  response: number | null;
  responseOptions: CandidateAction[] | null;
  /** Every responder's answer, in the order they were asked. */
  responses: { responderId: number; index: number; option: CandidateAction }[];
  success: boolean;
  events: SimEvent[];
  emit(type: string, actors: readonly number[], data: Record<string, unknown>): SimEvent;
}

export interface Responder {
  responderId: number;
  options: CandidateAction[];
}

export interface ActionDef {
  id: ActionKind;
  name: string;
  candidates(p: Person, w: World): CandidateAction[];
  /** For actions another person must answer: who answers and with which options. */
  respond?(p: Person, c: CandidateAction, w: World): Responder | Responder[] | null;
  /** Called each tick while performing a continuous action. */
  tickEffect?(p: Person, c: CandidateAction, w: World, performed: number): void;
  isDone?(p: Person, c: CandidateAction, w: World, performed: number): boolean;
  /** Applies the outcome and returns the resulting events (including traces). */
  resolve(p: Person, c: CandidateAction, w: World, ctx: ResolveCtx): SimEvent[];
}
