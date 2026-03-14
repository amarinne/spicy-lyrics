/**
 * install-windows.ts
 *
 * Builds a release bundle and copies it to the Windows Spicetify extensions
 * directory. Intended to be run from WSL.
 *
 * Usage:
 *   deno task install-windows
 *
 * Configuration (environment variables):
 *   SPICETIFY_EXTENSIONS_DIR
 *     Full path to the Spicetify Extensions directory.
 *     If not set, the path is derived automatically from the Windows username.
 *
 * After the copy, run on Windows:
 *   spicetify apply
 */

import { Bundle } from "@spicetify/bundler/cli";
import { ProjectName, ProjectVersion } from "./config.ts";

const builtFile = `./builds/${ProjectName}@${ProjectVersion}.mjs`;

async function resolveExtensionsDir(): Promise<string> {
  const fromEnv = Deno.env.get("SPICETIFY_EXTENSIONS_DIR");
  if (fromEnv) return fromEnv;

  // Try to get the actual Windows username via cmd.exe (available in WSL)
  let winUser: string | null = null;
  try {
    const cmd = new Deno.Command("cmd.exe", { args: ["/c", "echo %USERNAME%"], stdout: "piped" });
    const { stdout } = await cmd.output();
    winUser = new TextDecoder().decode(stdout).trim();
  } catch {
    // not in WSL or cmd.exe unavailable
  }

  if (!winUser) {
    winUser = Deno.env.get("USER") ?? "User";
    console.warn(`Could not detect Windows username, falling back to "${winUser}".`);
    console.warn(`Set SPICETIFY_EXTENSIONS_DIR explicitly if the path is wrong.`);
  }

  return `/mnt/c/Users/${winUser}/AppData/Local/spicetify/Extensions`;
}

const extensionsDir = await resolveExtensionsDir();
const targetFile = `${extensionsDir}/${ProjectName}@${ProjectVersion}.mjs`;

console.log(`Building ${ProjectName}@${ProjectVersion}...`);

Bundle({
  Type: "Release",
  Name: ProjectName,
  Version: ProjectVersion,
  EntrypointFile: "./src/app.tsx",
  CustomBuildOptions: {
    skipGlobalReplacementRules: true,
  },
});

// Verify build output exists
try {
  await Deno.stat(builtFile);
} catch {
  console.error(`Build failed: ${builtFile} not found.`);
  Deno.exit(1);
}

// Ensure target directory exists
try {
  await Deno.mkdir(extensionsDir, { recursive: true });
} catch (e) {
  if (!(e instanceof Deno.errors.AlreadyExists)) {
    console.error(`Cannot create extensions directory: ${extensionsDir}`);
    console.error(String(e));
    Deno.exit(1);
  }
}

// Copy the built file
console.log(`Copying to: ${targetFile}`);
await Deno.copyFile(builtFile, targetFile);

console.log(`\nDone. Run on Windows:\n  spicetify apply`);
