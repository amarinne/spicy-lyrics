/** Build the private inline pack from the engine export. No download runs during packaging. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
const input = process.argv[2];
if (!input) throw new Error('Usage: node tools/build-mandarin-g2pm-assets.mjs <verified-engine-export>');
const filenames = ['manifest.json', 'model.f32', 'model-vocab.json', 'classes.txt', 'digest.json', 'characters.tsv', 'phrases.tsv', 't2s.tsv'];
const files = {};
const receipts = {};
for (const name of filenames) {
  const bytes = await readFile(resolve(input, name));
  receipts[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  files[name] = name === 'model.f32' ? bytes.toString('base64') : bytes.toString('utf8');
}
const manifest = JSON.parse(files['manifest.json']);
for (const [name, receipt] of Object.entries(receipts)) {
  if (name === 'manifest.json') continue;
  const expected = manifest.files[name];
  if (!expected || expected.sha256 !== receipt.sha256 || expected.bytes !== receipt.bytes) {
    throw new Error(`Engine export does not match manifest: ${name}`);
  }
}
const raw = Buffer.from(JSON.stringify({ schema: 1, files, receipts }));
const sha256 = createHash('sha256').update(raw).digest('hex');
const gzip = gzipSync(raw, { level: 9, mtime: 0 });
const output = new URL('../src/utils/Lyrics/Fork/MandarinG2pm/assets.generated.ts', import.meta.url);
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, `// Private evaluation asset. Regenerate with tools/build-mandarin-g2pm-assets.mjs.\nexport const identity = ${JSON.stringify(sha256)};\nexport const encoded = ${JSON.stringify(gzip.toString('base64'))};\n`);
await mkdir(new URL('../tools/.cache/', import.meta.url), { recursive: true });
await writeFile(new URL('../tools/.cache/mandarin-g2pm-pack.json', import.meta.url), JSON.stringify({ schema: 1, sha256, rawBytes: raw.length, gzipBytes: gzip.length, files: receipts }, null, 2));
console.log(JSON.stringify({ sha256, rawBytes: raw.length, gzipBytes: gzip.length }));
