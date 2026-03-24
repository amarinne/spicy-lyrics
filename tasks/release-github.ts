/**
 * release-github.ts
 *
 * Builds a release bundle and publishes it as a GitHub Release, uploading
 * the .js as a downloadable asset.
 *
 * Creates the release if it doesn't exist; updates it if it does.
 * The existing asset is replaced if a file with the same name is already
 * attached to the release.
 *
 * Usage:
 *   GITHUB_TOKEN=... bun run tasks/release-github.ts
 *
 * Requirements:
 *   GITHUB_TOKEN  Personal access token with repo scope (or fine-grained
 *                 token with Contents: read/write on this repo).
 *
 * The repo owner/name are inferred from the git remote automatically.
 */

import { $ } from "bun";
import { existsSync, readFileSync } from "fs";
import { ProjectName, ProjectVersion } from "./config.ts";

const TAG = `v${ProjectVersion}`;
const RELEASE_NAME = `${ProjectName} ${ProjectVersion}`;
const ASSET_NAME = `${ProjectName}.js`;
const BUILT_FILE = `./dist/${ASSET_NAME}`;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  console.error("Create a token at https://github.com/settings/tokens with repo scope.");
  process.exit(1);
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
  const url = (await $`git remote get-url origin`.text()).trim();
  // git@github.com:owner/repo.git  or  https://github.com/owner/repo.git
  const match = url.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
  if (!match) {
    console.error(`Cannot parse GitHub repo from remote URL: ${url}`);
    process.exit(1);
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

await $`bun run build`;

if (!existsSync(BUILT_FILE)) {
  console.error(`Build failed: ${BUILT_FILE} not found.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Create or update the GitHub release
// ---------------------------------------------------------------------------

async function getReleaseByTag(): Promise<{ id: number; upload_url: string } | null> {
  const res = await fetch(`${API}/releases/tags/${TAG}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`Failed to check release: ${res.status} ${await res.text()}`);
    process.exit(1);
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
    process.exit(1);
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
// Upload the .js asset
// ---------------------------------------------------------------------------

// upload_url looks like: https://uploads.github.com/repos/.../assets{?name,label}
const uploadBase = release.upload_url.replace(/\{.*\}$/, "");
const uploadUrl = `${uploadBase}?name=${encodeURIComponent(ASSET_NAME)}`;

console.log(`\nUploading ${ASSET_NAME}...`);

const fileBytes = readFileSync(BUILT_FILE);
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
  process.exit(1);
}

const asset = await uploadRes.json();
console.log(`\nDone.`);
console.log(`Release: https://github.com/${owner}/${repo}/releases/tag/${TAG}`);
console.log(`Asset:   ${asset.browser_download_url}`);
