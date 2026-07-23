import type { Project } from "./types";
import { projectStages } from "./flow";

/**
 * Loop pricing.
 *
 * A "loop" is one full route through a project's movement flow
 * (primary → stage 1 → … → back to primary). When a stage offers several
 * alternatives (1.a, 1.b, 1.c…), each choice makes a *different* loop with its
 * own price — e.g.
 *     MW → Tier 1 (1.a) → OEM   costs X
 *     MW → Tier 1 (1.b) → OEM   costs Y
 * Loops are keyed by the branch choices so a price survives edits to the flow.
 */

export interface Loop {
  key: string;        // stable id: branch choices joined by "|", or "__single__"
  label: string;      // human path, e.g. "Master Warehouse → 1.a → OEM"
  path: string[];     // ordered location per stage
  branches: string[]; // just the chosen locations at branching stages
}

const SINGLE = "__single__";

/**
 * Every distinct priced loop of a project.
 * The number of loops = product of the sizes of the branching stages
 * (a flow with no branch yields exactly one loop).
 */
export function projectLoops(project: Project | undefined): Loop[] {
  const stages = projectStages(project);
  if (stages.length === 0) return [];

  // Which stage indices actually branch (offer > 1 alternative)
  const branchIdx = stages.reduce<number[]>((acc, s, i) => (s.length > 1 ? [...acc, i] : acc), []);

  // Cartesian product of every stage's alternatives → one path per loop
  let paths: string[][] = [[]];
  for (const stage of stages) {
    const alts = stage.length ? stage : [""];
    paths = paths.flatMap((p) => alts.map((a) => [...p, a]));
  }

  return paths.map((path) => {
    const branches = branchIdx.map((i) => path[i]);
    return {
      key: branches.length ? branches.join("|") : SINGLE,
      label: path.filter(Boolean).join(" → "),
      path,
      branches,
    };
  });
}

/**
 * The loop cost that applies to a Delivery Challan leg (fromLocation → toLocation).
 *
 * - No flow / no price set → null (caller falls back to the asset's unit cost).
 * - Single loop → that loop's price.
 * - Branching flow → the loop identified by whichever branch location the leg
 *   touches (as its origin or destination). If the leg touches no branch
 *   location, or the match is ambiguous (multiple branch stages), returns null
 *   so the caller can fall back gracefully.
 */
export function resolveLoopCost(
  project: Project | undefined,
  fromLocation: string,
  toLocation: string,
): number | null {
  const loops = projectLoops(project);
  if (loops.length === 0) return null;
  const costs = project?.loopCosts ?? {};

  const priceOf = (key: string): number | null => {
    const c = costs[key];
    return typeof c === "number" ? c : null;
  };

  if (loops.length === 1) return priceOf(loops[0].key);

  const legLocs = new Set([fromLocation, toLocation]);
  const matches = loops.filter((l) => l.branches.some((b) => legLocs.has(b)));
  const keys = new Set(matches.map((m) => m.key));
  if (keys.size === 1) return priceOf(matches[0].key);

  return null; // ambiguous or untouched — let the caller use the unit cost
}
