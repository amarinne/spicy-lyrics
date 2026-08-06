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
    plugins: [stubEmbeddedJapaneseAssets],
  },
});
