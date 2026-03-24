/**
 * install-windows.ts
 *
 * Builds a release bundle and copies it to the Windows Spicetify extensions
 * directory. Intended to be run from WSL.
 *
 * Usage:
 *   bun run tasks/install-windows.ts
 *
 * Configuration (environment variables):
 *   SPICETIFY_EXTENSIONS_DIR
 *     Full path to the Spicetify Extensions directory.
 *     If not set, the path is derived automatically from the Windows username.
 *
 * After the copy, run on Windows:
 *   spicetify apply
 */

import { $ } from "bun";
import { copyFileSync, existsSync, mkdirSync, statSync } from "fs";
import { ProjectName, ProjectVersion } from "./config.ts";

const builtFile = `./dist/${ProjectName}.js`;

async function resolveExtensionsDir(): Promise<string> {
  const fromEnv = process.env.SPICETIFY_EXTENSIONS_DIR;
  if (fromEnv) return fromEnv;

  // Try to get the actual Windows username via cmd.exe (available in WSL)
  let winUser: string | null = null;
  try {
    const result = await $`cmd.exe /c echo %USERNAME%`.text();
    winUser = result.trim();
  } catch {
    // not in WSL or cmd.exe unavailable
  }

  if (!winUser) {
    winUser = process.env.USER ?? "User";
    console.warn(`Could not detect Windows username, falling back to "${winUser}".`);
    console.warn(`Set SPICETIFY_EXTENSIONS_DIR explicitly if the path is wrong.`);
  }

  return `/mnt/c/Users/${winUser}/AppData/Local/spicetify/Extensions`;
}

const extensionsDir = await resolveExtensionsDir();
const targetFile = `${extensionsDir}/${ProjectName}.js`;

console.log(`Building ${ProjectName}@${ProjectVersion}...`);

// Run the build
await $`bun run build`;

// Verify build output exists
if (!existsSync(builtFile)) {
  console.error(`Build failed: ${builtFile} not found.`);
  process.exit(1);
}

// Ensure target directory exists
mkdirSync(extensionsDir, { recursive: true });

// Copy the built file
console.log(`Copying to: ${targetFile}`);
copyFileSync(builtFile, targetFile);

console.log(`\nDone. Run on Windows:\n  spicetify apply`);
