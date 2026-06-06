Personal fork of [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics) with extra reading, romanization, and translation features.

## Fork features

- Japanese furigana and romaji, generated from full lyric-line context
- Chinese pinyin or Jyutping romanization
- Korean, Cyrillic, and Greek romanization
- Optional Google Translate extra line for foreign or mixed-language lyrics
- Extra lyric lines supported in static, line-synced, and syllable-synced views
- Plain-lyric fast path, so English-only songs avoid reading/translation processing

## Installation

Requires [Spicetify](https://spicetify.app/).

1. Download `spicy-lyrics.mjs` from the [latest release](https://github.com/amarinne/spicy-lyrics/releases/latest).
2. Copy it to your Spicetify Extensions directory:
   - **Windows:** `%LOCALAPPDATA%\spicetify\Extensions`
   - **Linux:** `~/.config/spicetify/Extensions`
   - **macOS:** `~/.config/spicetify/Extensions`
3. Register the extension (run once):
   ```
   spicetify config extensions spicy-lyrics.mjs
   spicetify apply
   ```

To update, download the new `.mjs` from the latest release, replace the file, and run `spicetify apply`.

