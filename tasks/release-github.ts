/**
 * release-github.ts
 *
 * Builds a release bundle and publishes it as a GitHub Release, uploading
 * the .mjs as a downloadable asset.
 *
 * Creates the release if it doesn't exist; updates it if it does.
 * The existing asset is replaced if a file with the same name is already
 * attached to the release.
 *
 * Usage:
 *   deno task release-github
 *
 * Requirements:
 *   GITHUB_TOKEN  Personal access token with repo scope (or fine-grained
 *                 token with Contents: read/write on this repo).
 *
 * The repo owner/name are inferred from the git remote automatically.
 */

import { Bundle } from "@spicetify/bundler/cli";
import { ProjectName, ProjectVersion } from "./config.ts";

const TAG = `v${ProjectVersion}`;
const RELEASE_NAME = `${ProjectName} ${ProjectVersion}`;
const ASSET_NAME = `${ProjectName}@${ProjectVersion}.mjs`;
const BUILT_FILE = `./builds/${ASSET_NAME}`;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const token = Deno.env.get("GITHUB_TOKEN");
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  console.error("Create a token at https://github.com/settings/tokens with repo scope.");
  Deno.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "spicy-lyrics-release-script",
};

// ---------------------------------------------------------------------------
// Infer repo from git remote
// ---------------------------------------------------------------------------

async function getRepo(): Promise<{ owner: string; repo: string }> {
  const cmd = new Deno.Command("git", { args: ["remote", "get-url", "origin"], stdout: "piped" });
  const { stdout } = await cmd.output();
  const url = new TextDecoder().decode(stdout).trim();
  // git@github.com:owner/repo.git  or  https://github.com/owner/repo.git
  const match = url.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
  if (!match) {
    console.error(`Cannot parse GitHub repo from remote URL: ${url}`);
    Deno.exit(1);
  }
  return { owner: match[1], repo: match[2] };
}

const { owner, repo } = await getRepo();
const API = `https://api.github.com/repos/${owner}/${repo}`;

console.log(`Repo: ${owner}/${repo}`);

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

console.log(`\nBuilding ${ASSET_NAME}...`);

Bundle({
  Type: "Release",
  Name: ProjectName,
  Version: ProjectVersion,
  EntrypointFile: "./src/app.tsx",
  CustomBuildOptions: {
    skipGlobalReplacementRules: true,
  },
});

try {
  await Deno.stat(BUILT_FILE);
} catch {
  console.error(`Build failed: ${BUILT_FILE} not found.`);
  Deno.exit(1);
}

// ---------------------------------------------------------------------------
// Create or update the GitHub release
// ---------------------------------------------------------------------------

async function getReleaseByTag(): Promise<{ id: number; upload_url: string } | null> {
  const res = await fetch(`${API}/releases/tags/${TAG}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`Failed to check release: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  return res.json();
}

async function createRelease(): Promise<{ id: number; upload_url: string }> {
  const res = await fetch(`${API}/releases`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: TAG,
      name: RELEASE_NAME,
      draft: false,
      prerelease: false,
    }),
  });
  if (!res.ok) {
    console.error(`Failed to create release: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  return res.json();
}

console.log(`\nChecking GitHub release ${TAG}...`);
let release = await getReleaseByTag();

if (release) {
  console.log(`Release ${TAG} already exists (id ${release.id}), reusing.`);
} else {
  console.log(`Creating release ${TAG}...`);
  release = await createRelease();
  console.log(`Release created (id ${release.id}).`);
}

// ---------------------------------------------------------------------------
// Delete existing asset with the same name (if any)
// ---------------------------------------------------------------------------

async function deleteExistingAsset(releaseId: number): Promise<void> {
  const res = await fetch(`${API}/releases/${releaseId}/assets`, { headers });
  if (!res.ok) return;
  const assets: { id: number; name: string }[] = await res.json();
  const existing = assets.find((a) => a.name === ASSET_NAME);
  if (!existing) return;
  console.log(`Replacing existing asset (id ${existing.id})...`);
  await fetch(`${API}/releases/assets/${existing.id}`, { method: "DELETE", headers });
}

await deleteExistingAsset(release.id);

// ---------------------------------------------------------------------------
// Upload the .mjs asset
// ---------------------------------------------------------------------------

// upload_url looks like: https://uploads.github.com/repos/.../assets{?name,label}
const uploadBase = release.upload_url.replace(/\{.*\}$/, "");
const uploadUrl = `${uploadBase}?name=${encodeURIComponent(ASSET_NAME)}`;

console.log(`\nUploading ${ASSET_NAME}...`);

const fileBytes = await Deno.readFile(BUILT_FILE);
const uploadRes = await fetch(uploadUrl, {
  method: "POST",
  headers: {
    ...headers,
    "Content-Type": "application/octet-stream",
    "Content-Length": String(fileBytes.byteLength),
  },
  body: fileBytes,
});

if (!uploadRes.ok) {
  console.error(`Upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  Deno.exit(1);
}

const asset = await uploadRes.json();
console.log(`\nDone.`);
console.log(`Release: https://github.com/${owner}/${repo}/releases/tag/${TAG}`);
console.log(`Asset:   ${asset.browser_download_url}`);
