import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@spicemod/creator";
import { ProjectName, ProjectVersion } from "./project/config";

const japaneseAssetsStub = fileURLToPath(
  new URL("./project/japanese-assets-stub.js", import.meta.url)
);

/**
 * japanese-lyrics-processor embeds UniDic and JMdict as base64 gzip blobs
 * (~66MB). It loads them via dynamic import so a code-splitting bundler keeps
 * them out of the entry chunk, but this build is a single-file IIFE with no
 * splitting, so esbuild inlines them even though the fork fetches the
 * dictionaries at runtime instead. Redirecting the generated modules to a stub
 * keeps them out of the bundle.
 */
const stubEmbeddedJapaneseAssets = {
  name: "stub-embedded-japanese-assets",
  setup(build: {
    onResolve: (
      options: { filter: RegExp },
      callback: () => { path: string }
    ) => void;
  }) {
    // esbuild compiles filters with Go's regexp engine, which rejects the `u` flag.
    build.onResolve({ filter: /(unidic|jmdict)-assets\.generated(\.[cm]?[jt]s)?$/ }, () => ({
      path: japaneseAssetsStub,
    }));
  },
};

/**
 * Mandarin eza式 sandhi segments lines with jieba-wasm. Its browser build fetches the wasm from a
 * URL next to the module, which a single-file bundle does not have, so the bytes are inlined
 * (binary loader) and passed to its initializer. No network call at runtime.
 * The loader's unused default URL reads `import.meta.url`, which is a syntax error in a classic
 * script, so that one expression is replaced with `undefined` at build time.
 */
const jiebaWasmBytes = fileURLToPath(
  new URL("./node_modules/jieba-wasm/pkg/web/jieba_rs_wasm_bg.wasm", import.meta.url)
);
const inlineJiebaWasm = {
  name: "inline-jieba-wasm",
  setup(build: {
    onResolve: (
      options: { filter: RegExp },
      callback: () => { path: string }
    ) => void;
    onLoad: (
      options: { filter: RegExp },
      callback: (args: { path: string }) => Promise<{ contents: string; loader: "js" }>
    ) => void;
  }) {
    build.onResolve({ filter: /^jieba-wasm-bytes$/ }, () => ({ path: jiebaWasmBytes }));
    build.onLoad({ filter: /jieba-wasm[\\/]pkg[\\/]web[\\/]jieba_rs_wasm\.js$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      if (!source.includes("import.meta.url")) throw new Error("jieba-wasm web loader changed; review the import.meta rewrite");
      return { contents: source.replaceAll("import.meta.url", "undefined"), loader: "js" };
    });
  },
};

export default defineConfig({
  name: ProjectName,
  version: ProjectVersion,
  framework: "react",
  linter: "oxlint",
  template: "extension",
  packageManager: "bun",
  cssId: "slstyles",
  devModeVarName: "__SLdev__m",
  esbuildOptions: {
    legalComments: "inline",
    loader: { ".wasm": "binary" },
    plugins: [stubEmbeddedJapaneseAssets, inlineJiebaWasm],
  },
});
