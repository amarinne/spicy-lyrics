# Furigana Rendering Map

Goal: Japanese readings come from full-line context, then render as one stable DOM contract across static, line, and syllable lyrics.

## Data flow

1. `src/utils/Lyrics/Reading/JapaneseReading.ts`
   - `analyzeJapaneseLine()` tokenizes full line once.
   - Emits plain data only: `{ sourceText, romaji, furigana: [{ start, end, reading }] }`.
   - No HTML/ruby strings.

2. `src/utils/Lyrics/ProcessLyrics.ts`
   - Static/line entries get `JapaneseReading` directly.
   - Syllable lyrics call `applyJapaneseReadingToSyllables()` after full-line romaji generation.
   - Per-syllable readings are projections from line context, not fresh per-syllable analysis.

3. `src/utils/Lyrics/Applyer/ReadingRenderer.ts`
   - Owns reading mode decisions and extra lines.
   - Renders furigana clusters, romaji below, translation below.

4. Applyers
   - `Applyer/Static.ts`, `Applyer/Synced/Line.ts`, `Applyer/Synced/Syllable.ts` render timing/base lyric only, then call shared reading renderer.

5. CSS
   - `src/css/Lyrics/main.css`
   - `.furigana-cluster` uses inline-grid: reading row above base row.
   - No absolute furigana overlay; virtualizer measures real height.

## DOM contract

```text
.line(.has-furigana)
├─ text nodes / .furigana-cluster
│  ├─ .furigana-reading
│  └─ .furigana-base
├─ .romanized-below
└─ .translated-below
```

Syllable mode keeps `.word` as animation target. Furigana cluster lives inside `.word`.

## Rules

- Generate readings from full-line context only.
- No renderer HTML in processed lyric data.
- No absolute furigana positioning.
- No virtualizer furigana gap hack; row height must be measurable.
- Reading modes stay absolute: `romaji`, `furigana`, `both`.
