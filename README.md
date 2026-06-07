Personal fork of [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics).

## Fork stuff

Lyrics:
- JP furigana / romaji
- CN pinyin / jyutping
- KR / Cyrillic / Greek romanization
- Google Translate line
- mixed-language translate
- static / line / syllable modes work
- plain English skips romanization/translation path

UI:
- flat controls by default, no liquid glass buttons
- force dark background toggle
- copy lyrics button, multiple formats
- romanization / translation quick toggles
- Chinese translit quick toggle
- prefetch next lyrics
- cache migration for old processed lyrics

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

