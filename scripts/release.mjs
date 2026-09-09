import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const requested = process.argv[2];
if (!["patch", "minor", "major"].includes(requested) && !/^\d+\.\d+\.\d+$/.test(requested ?? "")) throw new Error("Usage: npm run release -- patch|minor|major|X.Y.Z");
if (git("status", "--porcelain")) throw new Error("Commit all changes before releasing");
if (git("branch", "--show-current") !== "main") throw new Error("Release from main");
git("fetch", "origin", "main", "--tags");
if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) throw new Error("Push or pull main before releasing");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const old = version.split(".").map(Number);
const bumped = [...old];
if (requested === "patch") bumped[2]++;
if (requested === "minor") { bumped[1]++; bumped[2] = 0; }
if (requested === "major") { bumped[0]++; bumped[1] = 0; bumped[2] = 0; }
const next = ["patch", "minor", "major"].includes(requested) ? bumped.join(".") : requested;
const parts = next.split(".").map(Number);
const difference = parts.findIndex((value, index) => value !== old[index]);
if (difference < 0 || parts[difference] <= old[difference]) throw new Error("New version must be greater than current version");
if (git("tag", "--list", `v${next}`)) throw new Error("Release tag already exists");
const changelog = await readFile("CHANGELOG.md", "utf8");
const notes = changelog.split(/^## Unreleased[ \t]*\r?\n/m)[1]?.split(/^## /m)[0].trim();
if (!notes) throw new Error("Add release notes under ## Unreleased in CHANGELOG.md, commit, and push them first");
execFileSync("npm", ["version", next, "--no-git-tag-version", "--ignore-scripts"], { stdio: "inherit" });
await writeFile("CHANGELOG.md", changelog.replace("## Unreleased", `## Unreleased\n\n## ${next} — ${new Date().toISOString().slice(0, 10)}`));
execFileSync("npm", ["run", "check"], { stdio: "inherit" });
git("add", "package.json", "package-lock.json", "CHANGELOG.md");
git("commit", "-m", `Release v${next}`);
git("tag", "-a", `v${next}`, "-m", `Framehuddle v${next}`);
git("push", "--atomic", "origin", "HEAD:main", `refs/tags/v${next}`);
console.log(`Pushed v${next}. Follow https://github.com/b-nnett/framehuddle-cli/actions/workflows/release.yml`);
