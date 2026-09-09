import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { publicationState } from "../scripts/release-state.mjs";

const publisher = resolve("scripts/publish.mjs");
const release = (version, draft = false) => ({ tag_name: `v${version}`, draft, prerelease: false });

test("publication ordering applies to new releases and recovered drafts across all pages", () => {
  assert.throws(() => publicationState("0.2.0", [[release("0.2.0", true)], [release("0.3.0")]]), /already published/);
  assert.throws(() => publicationState("0.2.0", [[release("0.3.0")]]), /already published/);
  assert.equal(publicationState("0.4.0", [[release("0.3.0")], [release("0.4.0", true)]]).existing.draft, true);
  assert.deepEqual(publicationState("0.1.0", [[]]), { existing: null });
  assert.equal(publicationState("0.2.0", [[release("0.2.0"), release("0.3.0")]]).existing.draft, false);
  for (const invalid of [null, [], [{}], [[null]], [[{ tag_name: "v0.1.0" }]]])
    assert.throws(() => publicationState("0.2.0", invalid), /Invalid/);
});

async function fixture(t, history, apiFailure = false) {
  const dir = await mkdtemp(join(tmpdir(), "framehuddle-publisher-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "bin"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ version: "0.2.0" }));
  await writeFile(join(dir, "history.json"), JSON.stringify(history));
  const stub = join(dir, "bin", "gh");
  await writeFile(stub, `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync("calls.jsonl", JSON.stringify(args) + "\\n");
if (args[0] === "api") {
  if (process.env.STUB_API_FAILURE === "1") { console.error("HTTP request failed"); process.exit(1); }
  process.stdout.write(fs.readFileSync("history.json"));
} else if (args[0] === "release" && args[1] === "download") {
  for (const name of ["framehuddle-0.2.0.tgz", "SHA256SUMS"])
    fs.copyFileSync(path.join("canonical", name), path.join("release-assets/published", name));
}
`);
  await chmod(stub, 0o755);
  const run = () => spawnSync(process.execPath, [publisher], { cwd: dir, encoding: "utf8", env: {
    ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_REF_NAME: "v0.2.0", STUB_API_FAILURE: apiFailure ? "1" : "0",
  } });
  const calls = async () => (await readFile(join(dir, "calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  return { dir, run, calls };
}

test("publisher makes no changes if release history cannot be read", async t => {
  const f = await fixture(t, [], true);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /publication aborted/);
  assert.deepEqual(await f.calls(), [["api", "repos/b-nnett/framehuddle-cli/releases?per_page=100", "--paginate", "--slurp"]]);
});

test("publisher refuses older new releases and older drafts before upload or creation", async t => {
  for (const history of [[[release("0.3.0")]], [[release("0.2.0", true)], [release("0.3.0")]]]) {
    const f = await fixture(t, history);
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already published/);
    assert.equal((await f.calls()).length, 1);
  }
});

test("publisher creates first releases and resumes valid drafts only after verified history", async t => {
  for (const draft of [false, true]) {
    const f = await fixture(t, draft ? [[release("0.1.0"), release("0.2.0", true)]] : [[]]);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const calls = await f.calls();
    assert.equal(calls[1][1], draft ? "upload" : "create");
    assert.equal(calls[2][1], "edit");
    assert(calls[2].includes("--latest"));
  }
});

test("published-release retry verifies files and reuses canonical archive without publication", async t => {
  const f = await fixture(t, [[release("0.2.0"), release("0.3.0")]]);
  await mkdir(join(f.dir, "package", "dist"), { recursive: true });
  for (const name of ["LICENSE", "README.md", "THIRD_PARTY_LICENSES", "package.json", "dist/index.js"])
    await writeFile(join(f.dir, "package", name), `fixture ${name}`);
  await mkdir(join(f.dir, "canonical"));
  await mkdir(join(f.dir, "release-assets"));
  const names = ["package/LICENSE", "package/README.md", "package/THIRD_PARTY_LICENSES", "package/dist/index.js", "package/package.json"];
  execFileSync("tar", ["-czf", "canonical/framehuddle-0.2.0.tgz", ...names], { cwd: f.dir });
  execFileSync("tar", ["-czf", "release-assets/framehuddle-0.2.0.tgz", ...names.reverse()], { cwd: f.dir });
  const canonical = await readFile(join(f.dir, "canonical/framehuddle-0.2.0.tgz"));
  const checksum = `${createHash("sha256").update(canonical).digest("hex")}  framehuddle-0.2.0.tgz\n`;
  await writeFile(join(f.dir, "canonical/SHA256SUMS"), checksum);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(join(f.dir, "release-assets/framehuddle-0.2.0.tgz")), canonical);
  assert.equal(await readFile(join(f.dir, "release-assets/SHA256SUMS"), "utf8"), checksum);
  assert.deepEqual((await f.calls()).map(call => call.slice(0, 2)), [["api", "repos/b-nnett/framehuddle-cli/releases?per_page=100"], ["release", "download"]]);
});
