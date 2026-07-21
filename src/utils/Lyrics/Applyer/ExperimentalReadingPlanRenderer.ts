import { $adaptiveSectioning } from "../../stores.ts";
import type { RenderPlan } from "../Processing/Model.ts";

export type TimedReadingBinder = (spanId: string, element: HTMLElement) => void;

export function renderExperimentalReadingPlan(
  parent: HTMLElement,
  plan: RenderPlan,
  bindTimedTarget: TimedReadingBinder
): HTMLElement {
  const row = document.createElement("div");
  row.className = "romanized-below reading-plan-row";
  const adaptiveSectioning = $adaptiveSectioning.get();
  let currentGroupId: string | undefined;
  let group: HTMLSpanElement | undefined;
  for (const unit of plan.timedReadingUnits) {
    if (adaptiveSectioning && unit.logicalGroupId !== currentGroupId) {
      currentGroupId = unit.logicalGroupId;
      group = document.createElement("span");
      group.className = "reading-plan-group";
      group.dataset.logicalGroupId = currentGroupId;
      if (row.childElementCount > 0 && /^\s/u.test(unit.text)) group.style.marginLeft = "0.25em";
      row.appendChild(group);
    }
    const child = document.createElement("span");
    child.className = "romanized-syllable reading-plan-timed-unit";
    child.dataset.spanId = unit.spanId;
    child.textContent = unit.text.trimStart();
    if (!adaptiveSectioning && row.childElementCount > 0 && /^\s/u.test(unit.text)) {
      child.style.marginLeft = "0.25em";
    }
    (group ?? row).appendChild(child);
    bindTimedTarget(unit.spanId, child);
  }
  parent.appendChild(row);
  return row;
}
