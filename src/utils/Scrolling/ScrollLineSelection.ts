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

  const anchorIndex = resolveToLeadIndex(lines, activeIndices[0]);
  const lookaheadLine = getLookaheadLine(lines, anchorIndex);
  if (
    lookaheadLine === null ||
    getGroupEndTime(lines, anchorIndex) <= lookaheadLine.StartTime
  ) {
    return anchorIndex;
  }

  const firstIndex = activeIndices[0];
  const lastIndex = activeIndices[activeIndices.length - 1];
  return resolveToLeadIndex(lines, lastIndex - firstIndex <= 1 ? firstIndex : lastIndex);
}
