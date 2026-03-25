Personal fork of [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics) with additional romanization and translation features.

## Features

- Romanization as a secondary lyric line (romaji, pinyin, jyutping, Cyrillic BGN/PCGN)
- Pinyin / Jyutping toggle
- Google Translate integration

## Installation

Requires [Spicetify](https://spicetify.app/).

1. Download `spicy-lyrics.js` from the [latest release](https://github.com/amarinne/spicy-lyrics/releases/latest).
2. Copy it to your Spicetify Extensions directory:
   - **Windows:** `%LOCALAPPDATA%\spicetify\Extensions`
   - **Linux:** `~/.config/spicetify/Extensions`
   - **macOS:** `~/.config/spicetify/Extensions`
3. Register the extension (run once):
   ```
   spicetify config extensions spicy-lyrics.js
   spicetify apply
   ```

To update, download the new `.js` from the latest release, replace the file, and run `spicetify apply`.

