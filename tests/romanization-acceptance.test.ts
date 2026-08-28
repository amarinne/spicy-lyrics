import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptRomanization } from "../src/utils/Lyrics/Fork/RomanizationAcceptance.ts";

const hanRegex = /[一-鿿]/;

test("rejects romanization that leaves source script behind", () => {
  assert.equal(acceptRomanization("中国", "中国 rock", [hanRegex]), false);
});

test("accepts romanization that removes source script", () => {
  assert.equal(acceptRomanization("中国", "zhong guo", [hanRegex]), true);
});
