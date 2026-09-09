import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { formula } from "../scripts/formula.mjs";

const script = resolve("scripts/release.mjs");
const formulaScript = resolve("scripts/formula.mjs");

test("formula pins an immutable release URL and checksum and rejects invalid metadata", () => {
  const text = formula("1.2.3", "a".repeat(64));
  assert.match(text, /releases\/download\/v1\.2\.3\/framehuddle-1\.2\.3.tgz/);
  assert(text.includes(`sha256 "${"a".repeat(64)}"`));
  assert.match(text, /depends_on "node"/);
  assert.throws(() => formula("1.2.3\ninjected", "a".repeat(64)));
  assert.throws(() => formula("1.2.3", "invalid"));
});

test("formula regeneration refuses to downgrade a newer release", async t => {
  const dir = await mkdtemp(join(tmpdir(), "framehuddle-formula-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(dir, "archive.tgz"), "test bytes");
  await writeFile(join(dir, "framehuddle.rb"), formula("0.2.0", "a".repeat(64)));
  const result = spawnSync(process.execPath, [formulaScript, "archive.tgz", "framehuddle.rb"], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to downgrade/);
  assert.match(await readFile(join(dir, "framehuddle.rb"), "utf8"), /v0\.2\.0/);
});

test("release command bumps versions and changelog and atomically pushes a matching tag", async t => {
  const dir = await mkdtemp(join(tmpdir(), "framehuddle-release-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const remote = join(dir, "remote.git"), checkout = join(dir, "checkout");
  await mkdir(checkout);
  const git = (...args) => execFileSync("git", args, { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--bare", remote);
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.com");
  git("remote", "add", "origin", remote);
  await writeFile(join(checkout, "package.json"), JSON.stringify({ name: "release-fixture", version: "0.1.0", scripts: { check: "node -e \"process.exit(0)\"" } }, null, 2));
  await writeFile(join(checkout, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n- New behavior.\n\n## 0.1.0\n\n- First release.\n");
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: checkout, stdio: "pipe" });
  git("add", "."); git("commit", "-m", "Initial fixture"); git("push", "-u", "origin", "main");
  execFileSync(process.execPath, [script, "patch"], { cwd: checkout, stdio: "pipe" });
  assert.equal(JSON.parse(await readFile(join(checkout, "package.json"), "utf8")).version, "0.1.1");
  assert.equal(JSON.parse(await readFile(join(checkout, "package-lock.json"), "utf8")).version, "0.1.1");
  assert.equal(git("status", "--porcelain"), "");
  assert.equal(git("rev-parse", "HEAD"), git("rev-parse", "v0.1.1^{}"));
  assert.match(git("ls-remote", "--tags", "origin"), /refs\/tags\/v0\.1\.1/);
  assert.match(await readFile(join(checkout, "CHANGELOG.md"), "utf8"), /## Unreleased\n\n## 0\.1\.1 — \d{4}-\d{2}-\d{2}/);
  const repeat = spawnSync(process.execPath, [script, "patch"], { cwd: checkout, encoding: "utf8" });
  assert.equal(repeat.status, 1);
  assert.match(repeat.stderr, /Add release notes/);
});

test("tap publication adds the first untracked formula and is safe to repeat", async t => {
  const script = resolve("scripts/update-tap.mjs");
  const dir = await mkdtemp(join(tmpdir(), "framehuddle-tap-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const remote = join(dir, "remote.git"), checkout = join(dir, "checkout");
  await mkdir(checkout);
  const git = (...args) => execFileSync("git", args, { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--bare", remote); git("init", "-b", "main");
  git("config", "user.name", "Tap test"); git("config", "user.email", "test@example.com");
  git("remote", "add", "origin", remote);
  await writeFile(join(checkout, "README.md"), "Test tap");
  git("add", "README.md"); git("commit", "-m", "Initialize tap"); git("push", "-u", "origin", "main");
  await mkdir(join(checkout, "Formula"));
  const contents = formula("0.1.0", "a".repeat(64));
  await writeFile(join(checkout, "Formula/framehuddle.rb"), contents);
  execFileSync(process.execPath, [script, checkout], { stdio: "pipe" });
  const first = git("rev-parse", "HEAD");
  assert.equal(git("status", "--porcelain"), "");
  assert.equal(git("show", "origin/main:Formula/framehuddle.rb"), contents.trim());
  execFileSync(process.execPath, [script, checkout], { stdio: "pipe" });
  assert.equal(git("rev-parse", "HEAD"), first);
});
