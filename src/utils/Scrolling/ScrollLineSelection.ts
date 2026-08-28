export type ScrollTimingLine = {
  StartTime: number;
  EndTime: number;
  BGLine?: boolean;
};

/** Real lyric lines to look ahead when deciding whether to keep the upper anchor. */
const PIN_LOOKAHEAD = 2;

const isBackgroundLine = (line: ScrollTimingLine): boolean => line.BGLine === true;

const resolveToLeadIndex = (lines: readonly ScrollTimingLine[], index: number): number => {
  let resolved = index;
  while (resolved > 0 && isBackgroundLine(lines[resolved])) resolved -= 1;
  return resolved;
};

const getGroupEndTime = (lines: readonly ScrollTimingLine[], leadIndex: number): number => {
  let endTime = lines[leadIndex].EndTime;
  for (
    let index = leadIndex + 1;
    index < lines.length && isBackgroundLine(lines[index]);
    index += 1
  ) {
    endTime = Math.max(endTime, lines[index].EndTime);
  }
  return endTime;
};

const getLookaheadLine = (
  lines: readonly ScrollTimingLine[],
  leadIndex: number
): ScrollTimingLine | null => {
  let remaining = PIN_LOOKAHEAD;
  for (let index = leadIndex + 1; index < lines.length; index += 1) {
    if (isBackgroundLine(lines[index])) continue;
    remaining -= 1;
    if (remaining === 0) return lines[index];
  }
  return null;
};

export function selectScrollLineIndex(
  lines: readonly ScrollTimingLine[],
  position: number
): number | null {
  const activeIndices: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      typeof line.StartTime === "number" &&
      typeof line.EndTime === "number" &&
      line.StartTime <= position &&
      line.EndTime >= position
    ) {
      activeIndices.push(index);
    }
  }

  if (activeIndices.length === 0) return null;

  // Collapse active rows to unique resolved lead groups, in source order.
  const activeLeadGroups: { leadIndex: number; firstRowIndex: number }[] = [];
  const seenLeadIndices = new Set<number>();
  for (const index of activeIndices) {
    const leadIndex = resolveToLeadIndex(lines, index);
    if (seenLeadIndices.has(leadIndex)) continue;
    seenLeadIndices.add(leadIndex);
    activeLeadGroups.push({ leadIndex, firstRowIndex: index });
  }

  // A sustained old background tail must not keep an expired lead group
  // selected when a later lead group is active, so drop leading groups that
  // are only active through background rows while another group follows.
  const activeRowIndexSet = new Set(activeIndices);
  let first = 0;
  while (
    first < activeLeadGroups.length - 1 &&
    !activeRowIndexSet.has(activeLeadGroups[first].leadIndex)
  ) {
    first += 1;
  }

  const anchorIndex = activeLeadGroups[first].leadIndex;
  const lookaheadLine = getLookaheadLine(lines, anchorIndex);
  if (
    lookaheadLine === null ||
    getGroupEndTime(lines, anchorIndex) <= lookaheadLine.StartTime
  ) {
    return anchorIndex;
  }

  const firstIndex = activeLeadGroups[first].firstRowIndex;
  const lastIndex = activeIndices[activeIndices.length - 1];
  return resolveToLeadIndex(lines, lastIndex - firstIndex <= 1 ? firstIndex : lastIndex);
}
