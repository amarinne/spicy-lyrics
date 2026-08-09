import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_AI_REFINEMENT_PRESETS,
  DEFAULT_AI_REFINEMENT_PRESET_ID,
  deleteCustomAIRefinementPreset,
  parseCustomAIRefinementPresets,
  resolveAIRefinementPreset,
  saveCustomAIRefinementPreset,
} from "../src/utils/AIRefinementPresets.ts";

test("built-in refinement presets stay bounded and default to whole-document natural review", () => {
  assert.ok(BUILT_IN_AI_REFINEMENT_PRESETS.length >= 3);
  assert.ok(BUILT_IN_AI_REFINEMENT_PRESETS.length <= 8);
  const preset = resolveAIRefinementPreset("[]", DEFAULT_AI_REFINEMENT_PRESET_ID);
  assert.match(preset.instructions, /complete output natural and contextual/);
  assert.match(preset.instructions, /materially inaccurate, awkward, or inconsistent/);
  assert.match(preset.instructions, /alternative would not be better/);
});

test("custom refinement presets validate, persist, update, delete, and cannot shadow built-ins", () => {
  const saved = saveCustomAIRefinementPreset("[]", { id: "custom-one", name: " My preset ", instructions: " Keep the chorus warm. " });
  assert.deepEqual(parseCustomAIRefinementPresets(saved.json), [{ id: "custom-one", name: "My preset", instructions: "Keep the chorus warm.", builtIn: false }]);
  const updated = saveCustomAIRefinementPreset(saved.json, { id: "custom-one", name: "My preset", instructions: "Preserve the chorus." });
  assert.equal(resolveAIRefinementPreset(updated.json, "custom-one").instructions, "Preserve the chorus.");
  assert.deepEqual(parseCustomAIRefinementPresets(deleteCustomAIRefinementPreset(updated.json, "custom-one")), []);
  assert.deepEqual(parseCustomAIRefinementPresets(JSON.stringify([{ id: DEFAULT_AI_REFINEMENT_PRESET_ID, name: "Shadow", instructions: "Bad" }])), []);
});
