import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isAudioChineseMode, isRhymeChineseMode } from "../src/utils/Lyrics/ChineseTranslitMode.ts";

function load(relative: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/^import[\s\S]*?;\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const context = { ...dependencies, exports: {} as any };
  runInNewContext(compiled, context);
  return context.exports;
}

test("the real Chinese setting renders both auto pairs and persists each selection", () => {
  const components = load("src/components/ReactComponents/SettingsPanel/components.tsx", {
    React, forwardRef: React.forwardRef, useContext: React.useContext, useRef: React.useRef,
  });
  let selected = "pinyin";
  let status = "waiting";
  const { forkLyricsGroups } = load("src/components/ReactComponents/SettingsPanel/ForkSettings.tsx", {
    React, Select: components.Select, Toggle: components.Toggle, SPICY_LYRICS_BUILD_MARKER: "test",
    useStore: (store: any) => store.get(), isAudioChineseMode, isRhymeChineseMode,
    $chineseTranslitMode: { get: () => selected, set: (value: string) => { selected = value; } },
    $chineseAudioStatus: { get: () => status },
  });
  const setting = forkLyricsGroups.flatMap((g: any) => g.settings).find((s: any) => s.id === "chineseTranslitMode");
  for (const mode of ["auto", "auto-vn", "rhyme", "rhyme-vn", "pinyin", "pinyin-vn", "jyutping", "jyutping-vn"]) {
    const control = setting.Control({ label: setting.label });
    const nativeSelect = components.Select(control.props);
    nativeSelect.props.onChange({ currentTarget: { value: mode } });
    assert.equal(selected, mode);
    const html = renderToStaticMarkup(React.createElement(setting.Control, { label: setting.label }));
    assert.match(html, /aria-label="Chinese Transliteration"/);
    assert.match(html, new RegExp(`<option value="${mode}" selected=""`));
    assert.match(html, /Audio detection \(Pinyin \/ Jyutping\)/);
    assert.match(html, /Audio detection \(eza式\)/);
    assert.match(html, /Rhyme guess only \(Pinyin \/ Jyutping\)/);
    assert.match(html, /Rhyme guess only \(eza式\)/);
    if (mode === "auto-vn" && process.env.SPICY_SETTINGS_HTML) {
      writeFileSync(process.env.SPICY_SETTINGS_HTML, `<div><label>${setting.label}</label><span>${setting.description}</span>${html}<p>${setting.useNote()}</p></div>`);
    }
  }
  selected = "auto";
  status = "unavailable";
  assert.match(setting.useNote(), /unavailable/);
  status = "listening";
  assert.match(setting.useNote(), /three 30-second/);
  selected = "rhyme-vn";
  assert.match(setting.useNote(), /Rhyme guess only/);
  assert.doesNotMatch(setting.useNote(), /Listening|unavailable/);
  selected = "jyutping";
  assert.equal(setting.useNote(), false);
});
