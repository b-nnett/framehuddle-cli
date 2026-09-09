import { execFileSync, spawnSync } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const tag = `v${version}`;
assert.equal(process.env.GITHUB_REF_NAME, tag, "Tag must match package.json version");
const repo = "b-nnett/framehuddle-cli";
const assets = [`framehuddle-${version}.tgz`, "SHA256SUMS"];
const existing = spawnSync("gh", ["release", "view", tag, "--repo", repo, "--json", "isDraft"], { encoding: "utf8" });
if (existing.status === 0) {
  if (JSON.parse(existing.stdout).isDraft) {
    execFileSync("gh", ["release", "upload", tag, "--repo", repo, "--clobber", ...assets.map(name => `release-assets/${name}`)], { stdio: "inherit" });
  } else {
    await mkdir("release-assets/published", { recursive: true });
    execFileSync("gh", ["release", "download", tag, "--repo", repo, "--dir", "release-assets/published", "--clobber", ...assets.flatMap(name => ["--pattern", name])], { stdio: "inherit" });
    for (const name of assets) assert.deepEqual(await readFile(`release-assets/published/${name}`), await readFile(`release-assets/${name}`), "Published release assets are immutable");
    console.log(`Verified existing ${tag}; release assets unchanged.`);
    process.exit(0);
  }
} else {
  const latest = spawnSync("gh", ["api", `repos/${repo}/releases/latest`, "--jq", ".tag_name"], { encoding: "utf8" });
  if (latest.status === 0) {
    const previous = latest.stdout.trim().replace(/^v/, "").split(".").map(Number);
    const next = version.split(".").map(Number);
    assert(previous.length === 3 && previous.every(Number.isFinite), "Unexpected latest release version");
    const difference = next.findIndex((value, index) => value !== previous[index]);
    assert(difference !== -1 && next[difference] > previous[difference], "A new release must be newer than the latest published version");
  }
  execFileSync("gh", ["release", "create", tag, "--repo", repo, "--verify-tag", "--draft", "--title", `Framehuddle ${tag}`, "--notes-file", "release-assets/NOTES.md", ...assets.map(name => `release-assets/${name}`)], { stdio: "inherit" });
}
execFileSync("gh", ["release", "edit", tag, "--repo", repo, "--draft=false", "--latest"], { stdio: "inherit" });
