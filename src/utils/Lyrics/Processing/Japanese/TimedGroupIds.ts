import type { RenderPlan } from "../../Model.ts";

/** Timed unit IDs are provider owner IDs, never array positions. */
export function timedLogicalGroupIds(plan: RenderPlan | undefined): Map<string, string> {
  return new Map((plan?.timedReadingUnits || []).map((unit) => [unit.spanId, unit.logicalGroupId]));
}
