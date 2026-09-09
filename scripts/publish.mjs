import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { publicationState } from "./release-state.mjs";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const tag = `v${version}`;
assert.equal(process.env.GITHUB_REF_NAME, tag, "Tag must match package.json version");
const repo = "b-nnett/framehuddle-cli";
const assets = [`framehuddle-${version}.tgz`, "SHA256SUMS"];
// A successful, complete history lookup includes drafts and distinguishes an empty
// repository from every API/auth/network error. No mutation happens before it succeeds.
let pages;
try {
  pages = JSON.parse(execFileSync("gh", ["api", `repos/${repo}/releases?per_page=100`, "--paginate", "--slurp"], { encoding: "utf8", maxBuffer: 50_000_000 }));
} catch {
  throw new Error("Unable to read complete release history; publication aborted. Check GitHub authentication and connectivity, then retry.");
}
const { existing } = publicationState(version, pages);
if (existing) {
  if (existing.draft) {
    execFileSync("gh", ["release", "upload", tag, "--repo", repo, "--clobber", ...assets.map(name => `release-assets/${name}`)], { stdio: "inherit" });
  } else {
    await mkdir("release-assets/published", { recursive: true });
    execFileSync("gh", ["release", "download", tag, "--repo", repo, "--dir", "release-assets/published", "--clobber", ...assets.flatMap(name => ["--pattern", name])], { stdio: "inherit" });
    const archive = assets[0];
    const published = await readFile(`release-assets/published/${archive}`);
    const checksum = await readFile("release-assets/published/SHA256SUMS", "utf8");
    assert.equal(checksum.trim(), `${createHash("sha256").update(published).digest("hex")}  ${archive}`, "Published checksum must match the archive");
    // npm/tar versions can encode identical files with different tar metadata.
    // Compare every shipped file, then retain the already-published archive bytes.
    const expected = ["package/LICENSE", "package/README.md", "package/THIRD_PARTY_LICENSES", "package/dist/index.js", "package/package.json"].sort();
    for (const location of ["release-assets", "release-assets/published"]) {
      const entries = execFileSync("tar", ["-tzf", `${location}/${archive}`], { encoding: "utf8" }).trim().split("\n").sort();
      assert.deepEqual(entries, expected, "Unexpected file in release archive");
    }
    for (const name of expected) {
      const extract = location => execFileSync("tar", ["-xOzf", `${location}/${archive}`, name], { maxBuffer: 10_000_000 });
      assert.deepEqual(extract("release-assets/published"), extract("release-assets"), `Published file differs: ${name}`);
    }
    await writeFile(`release-assets/${archive}`, published);
    await writeFile("release-assets/SHA256SUMS", checksum);
    console.log(`Verified existing ${tag}; release assets unchanged.`);
    process.exit(0);
  }
} else {
  execFileSync("gh", ["release", "create", tag, "--repo", repo, "--verify-tag", "--draft", "--title", `Framehuddle ${tag}`, "--notes-file", "release-assets/NOTES.md", ...assets.map(name => `release-assets/${name}`)], { stdio: "inherit" });
}
execFileSync("gh", ["release", "edit", tag, "--repo", repo, "--draft=false", "--latest"], { stdio: "inherit" });
