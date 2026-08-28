// JavaScript config keeps Node from reparsing this file through TypeScript module inference.
import { defineConfig } from "oxlint";

export default defineConfig({
  env: {
    browser: true,
  },
  plugins: ["import", "typescript", "unicorn", "oxc"],
  jsPlugins: [
    "./.oxlint-plugins/positive-provider-output-budget.ts",
    "./.oxlint-plugins/no-swallowed-ai-rejection.ts",
  ],
  ignorePatterns: [
    "node_modules/**",
    "dist/**",
    "dist_legacy/**",
    "build/**",
    ".spicetify/**",
    "public-storage/**",
    "src/utils/SpicyHasher.ts",
    "src/utils/Lyrics/Aromanize.ts",
    "src/utils/Lyrics/Kuromoji.js",
    "src/utils/Lyrics/GreekRomanization.js",
  ],
  rules: {
    "no-console": "off",
    "radix": "off",
    "typescript/no-explicit-any": "off",
    "import/no-commonjs": "error",
    "typescript/consistent-type-imports": "warn",
    "positive-provider-output-budget/positive-provider-output-budget": "error",
  },
  overrides: [
    {
      files: [
        "src/utils/Lyrics/AIRefinement/**/*.{ts,tsx}",
        ".oxlint-plugins/__fixtures__/no-swallowed-ai-rejection.fixture.ts",
      ],
      rules: {
        "no-swallowed-ai-rejection/no-swallowed-ai-rejection": "error",
      },
    },
  ],
});
