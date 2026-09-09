import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectBounded, readBoundedFile, checkImageBudget, imageByteLength } from "../src/import";

test("bounded imports accept the byte limit and reject larger files before parsing", async t => {
  const dir = await mkdtemp(join(tmpdir(), "framehuddle-limits-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "file.json");
  await writeFile(file, "12345678");
  assert.equal((await readBoundedFile(file, 8)).toString(), "12345678");
  await assert.rejects(readBoundedFile(file, 7), /input limit/);
});

test("bounded streaming stops reading once the input budget is exceeded", async () => {
  let reads = 0;
  let closed = false;
  async function* chunks() {
    try { for (const part of ["abcd", "efgh", "ijkl"]) { reads++; yield Buffer.from(part); } }
    finally { closed = true; }
  }
  await assert.rejects(collectBounded(chunks(), 7), /input limit/);
  assert.equal(reads, 2);
  assert.equal(closed, true);
});

test("image budgets account for padding and stop before processing further screenshots", () => {
  assert.equal(imageByteLength("YQ==", "one"), 1);
  assert.equal(imageByteLength("YWI=", "two"), 2);
  assert.equal(imageByteLength("YWJj", "three"), 3);
  const screens = [{ id: "a", image: "YWJj" }, { id: "b", image: "YWI=" }];
  assert.equal(checkImageBudget(screens, 5), 5);
  assert.throws(() => checkImageBudget([...screens, { id: "unused", get image(): string { throw new Error("Must not read later image"); } }], 4), /decoded image budget/);
  for (const image of ["", "a", "====", "YQ=", "Y=Q=", "Y Q=", "YWJj\n"])
    assert.throws(() => imageByteLength(image, "frame"), /invalid base64/);
});

test("base64 validation handles an image at the supported byte limit", () => {
  const bytes = Buffer.alloc(3_000_000, 0x41);
  const image = bytes.toString("base64");
  assert.equal(checkImageBudget([{ id: "large", image }]), bytes.length);
  assert.throws(() => checkImageBudget([{ id: "oversize", image: image + "YQ==" }]), /Image exceeds 3 MB/);
});
