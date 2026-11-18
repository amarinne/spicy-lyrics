import { pinyin } from "pinyin-pro";
import { getJyutpingList } from "to-jyutping";

/** Body limit and span checks live in tools/chinese_audio_detector.py; this mirrors its line cap. */
export const CHINESE_AUDIO_LINE_LIMIT = 400;
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/gu;

export type ChineseAudioLyricLine = {
  /** Han characters of one lyric line, in order. */
  han: string;
  /** Toneless pinyin syllable per Han character. */
  py: string[];
  /** Toneless Jyutping syllable per Han character. */
  jp: string[];
};

function lineTexts(lyrics: any): string[] {
  const texts: string[] = [];
  if (!lyrics) return texts;
  if (lyrics.Type === "Static") {
    for (const line of lyrics.Lines ?? []) if (typeof line?.Text === "string") texts.push(line.Text);
    return texts;
  }
  const groups = Array.isArray(lyrics.Content) ? lyrics.Content : Object.values(lyrics.Content ?? {});
  for (const group of groups as any[]) {
    if (!group) continue;
    if (lyrics.Type === "Syllable") {
      const lead = group.Lead ?? {};
      const text = typeof lead.Text === "string"
        ? lead.Text
        : (lead.Syllables ?? []).map((syllable: any) => syllable?.Text ?? "").join("");
      if (text) texts.push(text);
    } else if ((group.Type === "Vocal" || group.Text) && typeof group.Text === "string") {
      texts.push(group.Text);
    }
  }
  return texts;
}

function alignedToHan(han: string, values: readonly string[]): string[] {
  return Array.from({ length: han.length }, (_, index) => values[index] ?? "");
}

/** Build the helper's per-line readings; a line contributes only its Han characters. */
export function chineseAudioLyricLines(lyrics: any): ChineseAudioLyricLine[] {
  const lines: ChineseAudioLyricLine[] = [];
  for (const text of lineTexts(lyrics)) {
    const han = (text.match(HAN) ?? []).join("");
    if (!han) continue;
    const py = alignedToHan(han, pinyin(han, { toneType: "none", type: "array", v: true }));
    const jp = alignedToHan(han, getJyutpingList(han).map(([, reading]) => (reading ?? "").replace(/\d$/u, "")));
    lines.push({ han, py, jp });
    if (lines.length >= CHINESE_AUDIO_LINE_LIMIT) break;
  }
  return lines;
}
