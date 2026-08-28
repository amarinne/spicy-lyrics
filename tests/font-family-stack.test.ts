import assert from "node:assert/strict";
import test from "node:test";
import { toCssFontFamilyStack, toHanLanguageFontStack } from "../src/utils/cssFontFamily.ts";

test("font family stack preserves fallback order and rejects injection", () => {
  assert.equal(
    toCssFontFamilyStack('Inter, "Noto Sans JP", Segoe UI, sans-serif'),
    '"Inter", "Noto Sans JP", "Segoe UI", sans-serif',
  );
  assert.equal(toCssFontFamilyStack("Inter; color: red, serif"), "serif");
});

test("Han stacks retain the primary font and reorder Noto fallbacks", () => {
  const stack = '"SF Pro Display", "Noto Sans JP", "Noto Sans SC", sans-serif';
  assert.equal(
    toHanLanguageFontStack(stack, "ja"),
    '"SF Pro Display", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", sans-serif',
  );
  assert.equal(
    toHanLanguageFontStack(stack, "zh-Hans"),
    '"SF Pro Display", "Noto Sans SC", "Noto Sans TC", "Noto Sans JP", sans-serif',
  );
  assert.equal(
    toHanLanguageFontStack(stack, "zh-Hant"),
    '"SF Pro Display", "Noto Sans TC", "Noto Sans SC", "Noto Sans JP", sans-serif',
  );
});
