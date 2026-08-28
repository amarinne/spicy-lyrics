export type ParsedLrcLine = { text: string; startTimeMs: number };
export type ParsedLrc = { synced: ParsedLrcLine[]; plain: string[] };

const METADATA = /^\s*\[(?:ar|al|ti|by|offset|language|re|ve|length)\s*:/iu;

export function parseLrcDocument(text: string): ParsedLrc {
  const synced: ParsedLrcLine[] = [];
  const plain: string[] = [];
  const offset = Number(/^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/imu.exec(text)?.[1] ?? 0);
  for (const rawLine of String(text).split(/\r?\n/u)) {
    let remainder = rawLine;
    const times: number[] = [];
    while (true) {
      const match = /^\s*\[(\d+):(\d+(?:\.\d+)?)\]/u.exec(remainder);
      if (!match) break;
      times.push(Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000) + offset);
      remainder = remainder.slice(match[0].length);
    }
    const content = remainder.trim();
    if (!times.length) {
      if (content && !METADATA.test(rawLine)) plain.push(content);
      continue;
    }
    for (const startTimeMs of times) if (content) synced.push({ text: content, startTimeMs });
  }
  return { synced, plain };
}
