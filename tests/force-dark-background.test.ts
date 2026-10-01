import assert from "node:assert/strict";
import { test } from "node:test";
import { backgroundColorToCss, withForceDarkBackground } from "../src/components/DynamicBG/Fork/ForceDarkBackground.ts";

test("Force Dark leaves upstream colors and Kawarp options unchanged when disabled", () => {
  const color = { red: 220, green: 160, blue: 80, alpha: 0.5 };
  const base = { saturation: 1.5, animationSpeed: 0.1, blurPasses: 8 };
  assert.equal(backgroundColorToCss(color, false), "220, 160, 80, 0.5");
  assert.equal(withForceDarkBackground(base, false), base);
});

test("Force Dark applies the existing dark palette without mutating upstream options", () => {
  const color = { red: 255, green: 255, blue: 255, alpha: 0.5 };
  assert.equal(backgroundColorToCss(color, true), "61, 61, 61, 0.5");
  const base = Object.freeze({ saturation: 1.5, animationSpeed: 0.1, blurPasses: 8 });
  const dark = withForceDarkBackground(base, true);
  assert.equal(dark.saturation, 0.75);
  assert.deepEqual(dark.tintColor, [0.025, 0.022, 0.03]);
  assert.equal(dark.tintIntensity, 0.38);
  assert.equal(dark.animationSpeed, base.animationSpeed);
  assert.equal(dark.blurPasses, base.blurPasses);
  assert.equal(base.saturation, 1.5);
});
