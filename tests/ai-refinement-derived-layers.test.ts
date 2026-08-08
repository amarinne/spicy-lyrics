import assert from "node:assert/strict";
import { test } from "node:test";
import { AIDerivedLayerComposer } from "../src/utils/Lyrics/AIRefinement/LayerComposer.ts";

function baseline(text = "사랑") {
  return {
    Type: "Static",
    Language: "kor",
    Lines: [{ Text: text, TranslatedText: "love", ReadingRenderPlan: { joinedDisplayText: "sarang", spans: [] }, JapaneseReading: { sourceText: text, romaji: "sarang", furigana: [] } }],
    IncludesTranslation: true,
    IncludesRomanization: true,
    HasTransliterations: true,
  };
}

test("Meaning and Sound overlays compose atomically and restore independently", () => {
  const publications: Array<{ document: any; origin: string }> = [];
  const composer = new AIDerivedLayerComposer((_trackUri, document, origin) => publications.push({ document: structuredClone(document), origin }));
  const source = baseline();
  composer.acceptBaseline("spotify:track:test", 7, source);

  const meaning = structuredClone(source);
  meaning.Lines[0].TranslatedText = "AI meaning";
  assert.equal(composer.acceptLayerPublication("spotify:track:test", "meaning", 7, meaning, "overlay"), true);
  const sound = structuredClone(source);
  sound.Lines[0].RomanizedText = "sa-rang";
  sound.Lines[0].TransliteratedText = "sa-rang";
  assert.equal(composer.acceptLayerPublication("spotify:track:test", "sound", 7, sound, "overlay"), true);

  const both = publications.at(-1)!.document;
  assert.equal(both.Lines[0].TranslatedText, "AI meaning");
  assert.equal(both.Lines[0].RomanizedText, "sa-rang");
  assert.equal(both.Lines[0].TransliteratedText, "sa-rang");
  assert.equal(both.Lines[0].ReadingRenderPlan, undefined);
  assert.equal(both.Lines[0].JapaneseReading, undefined);

  composer.acceptLayerPublication("spotify:track:test", "meaning", 7, source, "baseline");
  const soundOnly = publications.at(-1)!.document;
  assert.equal(soundOnly.Lines[0].TranslatedText, "love");
  assert.equal(soundOnly.Lines[0].RomanizedText, "sa-rang");

  composer.acceptLayerPublication("spotify:track:test", "sound", 7, source, "baseline");
  const restored = publications.at(-1)!.document;
  assert.equal(restored.Lines[0].TranslatedText, "love");
  assert.equal(restored.Lines[0].ReadingRenderPlan.joinedDisplayText, "sarang");
  assert.equal(restored.Lines[0].RomanizedText, undefined);
  assert.equal(source.Lines[0].ReadingRenderPlan.joinedDisplayText, "sarang");

  const reversePublications: any[] = [];
  const reverse = new AIDerivedLayerComposer((_trackUri, document) => reversePublications.push(structuredClone(document)));
  reverse.acceptBaseline("spotify:track:test", 8, source);
  reverse.acceptLayerPublication("spotify:track:test", "sound", 8, sound, "overlay");
  reverse.acceptLayerPublication("spotify:track:test", "meaning", 8, meaning, "overlay");
  assert.equal(reversePublications.at(-1).Lines[0].TranslatedText, "AI meaning");
  assert.equal(reversePublications.at(-1).Lines[0].RomanizedText, "sa-rang");
});

test("composer rejects stale revisions and source mismatches", () => {
  const publications: any[] = [];
  const composer = new AIDerivedLayerComposer((_trackUri, document) => publications.push(structuredClone(document)));
  composer.acceptBaseline("spotify:track:test", 2, baseline("new"));
  const stale = baseline("old");
  stale.Lines[0].TranslatedText = "stale AI";

  assert.equal(composer.acceptLayerPublication("spotify:track:test", "meaning", 1, stale, "overlay"), false);
  assert.equal(composer.acceptLayerPublication("spotify:track:test", "meaning", 2, stale, "overlay"), false);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].Lines[0].Text, "new");
});
