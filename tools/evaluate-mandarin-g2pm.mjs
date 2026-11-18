/** Emit dense code-point predictions through the same reader as the client. Inputs/outputs stay private. */
import { readFile, writeFile } from 'node:fs/promises';
import { ensureMandarinReader, readMandarinLine, mandarinReaderDebug } from '../src/utils/Lyrics/Fork/MandarinReader.ts';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node --experimental-strip-types tools/evaluate-mandarin-g2pm.mjs input.jsonl output.jsonl');
await ensureMandarinReader();
const started = performance.now();
const lines = (await readFile(input, 'utf8')).split('\n').filter(Boolean);
const records = [];
for (const line of lines) {
  const row = JSON.parse(line);
  const result = readMandarinLine(row.text ?? row.source);
  records.push(JSON.stringify({ schema: 'cjk-labs.mandarin-g2pm-eval.prediction.v1', engine: 'desktop-ts-g2pm',
    id: row.id, readings: result.syllables.map((s) => s.status === 'reading' ? { reading: s.raw, neutral: s.neutral, source: s.source } : null) }));
}
await writeFile(output, records.join('\n') + '\n');
console.log(JSON.stringify({ rows: records.length, runMs: performance.now() - started, ...mandarinReaderDebug.telemetry() }));
