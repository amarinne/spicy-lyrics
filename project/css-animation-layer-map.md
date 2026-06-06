# CSS Animation Layer Map

Purpose: keep lyric extras coupled to main renderer without adding separate animation paths.

## Core DOM

```text
SpicyLyricsPage
└─ .SpicyLyricsScrollContainer[data-lyrics-type]
   └─ .VirtualLyricsContainer
      └─ .line(.Active|.Sung|.NotSung|.static|.bg-line|.OppositeAligned)
         ├─ .word / .letterGroup / text
         │  └─ .furigana-cluster
         │     ├─ .furigana-reading
         │     └─ .furigana-base
         ├─ .romanized-below
         └─ .translated-below
```

## Animation owners

- Line/word/letter timing: `LyricsAnimator.ts`.
- DOM creation: static/line/syllable applyers.
- Furigana/romaji/translation DOM: `Applyer/ReadingRenderer.ts`.
- Height measurement: `LyricsVirtualizer.ts` via real `offsetHeight`.

## Furigana rule

Furigana must be normal layout, not paint overflow:

- `.furigana-cluster` is inline-grid.
- `.furigana-reading` is a measured row above `.furigana-base`.
- `.word.has-furigana` remains animator target in syllable mode.
- Reading row overrides text fill; base row inherits parent karaoke gradient.

## Failure checklist

- Overlap: cluster/pending row not contributing to height.
- Dim/missing kanji: base row stopped inheriting parent gradient/text fill.
- Toggle stale: PageView setting listener did not reapply cached lyrics.
- Virtualizer drift: rendered height not measurable via `offsetHeight`.
