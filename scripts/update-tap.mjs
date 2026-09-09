import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node scripts/update-tap.mjs TAP_CHECKOUT");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "inherit" });
git("config", "user.name", "framehuddle-release[bot]");
git("config", "user.email", "62760393+b-nnett@users.noreply.github.com");
// Stage first: an initial formula is untracked and invisible to plain git diff.
git("add", "Formula/framehuddle.rb");
const diff = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: directory });
if (diff.status === 0) {
  console.log("Homebrew tap is already up to date.");
} else if (diff.status === 1) {
  git("commit", "-m", `Update Framehuddle to ${version}`);
  git("push", "origin", "HEAD:main");
} else throw new Error("Could not inspect staged tap changes");
