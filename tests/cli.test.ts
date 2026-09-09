import pkg from "../package.json";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Client, normalizeOrigin } from "../src/client";
import { run } from "../src/commands";
import { importExport, readExport } from "../src/import";

const projectId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";
const rootId = "33333333-3333-4333-8333-333333333333";
const replyId = "44444444-4444-4444-8444-444444444444";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64");
const fixture = () => ({ schemaVersion: 1, export: { version: "v1", title: "Test" }, screens: [{
  id: "welcome", title: "Welcome", column: 0, row: 0, width: 1, height: 1,
  section: ["Onboarding"], image: png.toString("base64"), sha256: createHash("sha256").update(png).digest("hex"),
}] });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const capture = () => {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { out: (value: string) => out.push(value), err: (value: string) => err.push(value) } };
};
async function temporary(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "framehuddle-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function server(t: test.TestContext, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void) {
  const instance = createServer((req, res) => { Promise.resolve(handler(req, res)).catch(error => { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }); });
  await new Promise<void>(resolve => instance.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => instance.close(error => error ? reject(error) : resolve())));
  const address = instance.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("CLI validates API origins and refuses credential-bearing or insecure URLs", () => {
  assert.equal(normalizeOrigin("https://framehuddle.com/"), "https://framehuddle.com");
  assert.equal(normalizeOrigin("http://[::1]:3000"), "http://[::1]:3000");
  for (const value of ["http://example.com", "https://key@example.com", "https://example.com/path", "https://example.com?token=secret", "https://example.com#fragment"])
    assert.throws(() => normalizeOrigin(value));
});

test("CLI help, version and local validation need no credentials", async t => {
  const dir = await temporary(t), result = capture();
  await run(["--help"], {}, result.io, dir);
  assert.match(result.out[0], /exports import/);
  await run(["--version"], {}, result.io, dir);
  assert.equal(result.out[1], pkg.version);
  await writeFile(join(dir, "export.json"), JSON.stringify(fixture()));
  await run(["exports", "validate", "export.json", "--json"], {}, result.io, dir);
  assert.equal(JSON.parse(result.out[2]).valid, true);
  await assert.rejects(run(["projects", "ls"], {}, result.io, dir), /Unknown command/);
  await assert.rejects(run(["projects", "list", "--status", "open"], {}, result.io, dir), /not supported/);
  await assert.rejects(run(["projects", "list", "surprise"], {}, result.io, dir), /Too many arguments/);
});

test("CLI init stores selectors only and refuses to overwrite existing config", async t => {
  const dir = await temporary(t), result = capture();
  await run(["init", "--project", projectId, "--export", exportId], { FRAMEHUDDLE_API_KEY: "secret" }, result.io, dir);
  const config = JSON.parse(await readFile(join(dir, "framehuddle.config.json"), "utf8"));
  assert.deepEqual(config, { projectId, exportId });
  await assert.rejects(run(["init", "--project", projectId], {}, result.io, dir), /EEXIST/);
  await writeFile(join(dir, "framehuddle.config.json"), JSON.stringify({ projectId, url: "https://other.example" }));
  await assert.rejects(run(["projects", "list"], {}, result.io, dir), /Config supports only/);
});

test("client exhausts pagination and detects repeated cursors", async () => {
  const urls: string[] = [];
  const client = new Client("https://framehuddle.com", "secret", { fetch: (async url => {
    urls.push(String(url));
    return json(urls.length === 1 ? { items: [1], nextCursor: "a/b?" } : { items: [2], nextCursor: null });
  }) as typeof fetch });
  assert.deepEqual(await client.all("projects?limit=1"), [1, 2]);
  assert.match(urls[1], /&cursor=a%2Fb%3F$/);
  const repeating = new Client("https://framehuddle.com", "secret", { fetch: (async () => json({ items: [], nextCursor: "same" })) as typeof fetch });
  await assert.rejects(repeating.all("projects"), /repeated/);
});

test("client retries 429 using Retry-After but does not replay ambiguous failures or authorization errors", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const client = new Client("https://framehuddle.com", "secret", {
    sleep: async ms => { sleeps.push(ms); },
    fetch: (async (_url, options) => {
      assert.equal(options?.redirect, "error");
      calls++;
      return calls < 3 ? new Response("{}", { status: 429, headers: { "Retry-After": "2" } }) : json({ id: projectId });
    }) as typeof fetch,
  });
  await client.request("projects", "POST", { name: "Demo" });
  assert.deepEqual(sleeps, [2000, 2000]);
  for (const status of [401, 403, 500]) {
    calls = 0;
    const failing = new Client("https://framehuddle.com", "secret", { fetch: (async () => { calls++; return json({ error: "secret failure" }, status); }) as typeof fetch });
    await assert.rejects(failing.request("projects", "POST", {}), error => {
      assert(!String(error).includes("secret")); return true;
    });
    assert.equal(calls, 1);
  }
});

test("imports strip inline images, send original bytes, and publish only after successful uploads", async t => {
  const dir = await temporary(t), path = join(dir, "export.json");
  await writeFile(path, JSON.stringify(fixture()));
  const calls: string[] = [];
  const client = new Client("https://framehuddle.com", "secret", { fetch: (async (url, options) => {
    calls.push(`${options?.method} ${url}`);
    if (options?.method === "PUT") assert.deepEqual(Buffer.from(options.body as Uint8Array), png);
    else if (calls.length === 1) {
      const manifest = JSON.parse(options?.body as string);
      assert.equal(manifest.screens[0].image, undefined);
      return json({ id: exportId, status: "draft" });
    }
    return json({ id: exportId, status: "ready" });
  }) as typeof fetch });
  const result = await importExport(client, projectId, path, () => {});
  assert.equal(result.status, "ready");
  assert.equal(calls.length, 3);
  assert.match(calls[2], /POST .*\/complete$/);
  calls.length = 0;
  const ready = new Client("https://framehuddle.com", "secret", { fetch: (async () => { calls.push("POST"); return json({ id: exportId, status: "ready" }); }) as typeof fetch });
  await importExport(ready, projectId, path, () => {});
  assert.equal(calls.length, 1);
  const broken = fixture(); broken.screens[0].sha256 = "0".repeat(64);
  await writeFile(path, JSON.stringify(broken));
  await assert.rejects(importExport(ready, projectId, path, () => {}), /Checksum mismatch/);
  assert.equal(calls.length, 1);
});

test("imports stop on upload failure without publishing, and reject malformed base64", async t => {
  const dir = await temporary(t), path = join(dir, "export.json");
  await writeFile(path, JSON.stringify(fixture()));
  const calls: string[] = [];
  const client = new Client("https://framehuddle.com", "secret", { fetch: (async (_url, options) => {
    calls.push(options?.method ?? "GET");
    return options?.method === "PUT" ? json({ error: "bad image" }, 422) : json({ id: exportId, status: "draft" });
  }) as typeof fetch });
  await assert.rejects(importExport(client, projectId, path, () => {}), /bad image/);
  assert.deepEqual(calls, ["POST", "PUT"]);
  const broken = fixture(); broken.screens[0].image = "%%%%";
  await writeFile(path, JSON.stringify(broken));
  await assert.rejects(readExport(path), /invalid base64/);
});

test("feedback joins every page with screen context, and flags override environment and config", async t => {
  const dir = await temporary(t), result = capture(), urls: string[] = [];
  await writeFile(join(dir, "framehuddle.config.json"), JSON.stringify({ projectId: replyId, exportId: rootId }));
  const origin = await server(t, (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-key");
    urls.push(req.url!);
    res.setHeader("Content-Type", "application/json");
    if (!req.url!.includes("/comments")) res.end(JSON.stringify({ export: { version: "v1" }, screens: [{ id: "welcome", title: "Welcome", section: ["Onboarding"], width: 100, height: 200, imageUrl: "/private" }] }));
    else res.end(JSON.stringify({ items: [{ id: req.url!.includes("cursor") ? replyId : rootId, screenId: "welcome", parentId: req.url!.includes("cursor") ? rootId : null, x: .25, y: .5 }], nextCursor: req.url!.includes("cursor") ? null : rootId }));
  });
  await run(["feedback", "--project", projectId, "--export", exportId, "--status", "open", "--json"],
    { FRAMEHUDDLE_API_KEY: "test-key", FRAMEHUDDLE_URL: origin, FRAMEHUDDLE_PROJECT_ID: replyId }, result.io, dir);
  const feedback = JSON.parse(result.out[0]);
  assert.equal(feedback.comments.length, 2);
  assert.equal(feedback.comments[1].rootId, rootId);
  assert.equal(feedback.comments[0].pixelX, 25);
  assert.equal(feedback.comments[0].pixelY, 100);
  assert(urls.every(url => url.startsWith(`/api/v1/projects/${projectId}/exports/${exportId}`)));
  assert(urls.some(url => url.includes(`status=open&cursor=${rootId}`)));
  assert.equal(result.err.length, 0);
});

test("comment replies inherit the root pin, mutation guards prevent requests, and screenshots preserve bytes", async t => {
  const dir = await temporary(t), result = capture(), calls: string[] = [];
  const origin = await server(t, async (req, res) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.url!.endsWith("/screens/welcome")) { res.end(png); return; }
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET") { res.end(JSON.stringify({ items: [{ id: rootId, parentId: null, screenId: "welcome", x: .2, y: .3 }], nextCursor: null })); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual({ parentId: body.parentId, x: body.x, y: body.y, screenId: body.screenId }, { parentId: rootId, x: .2, y: .3, screenId: "welcome" });
    res.end(JSON.stringify({ id: replyId }));
  });
  const env = { VF_URL: origin, VF_API_KEY: "test-key", FRAMEHUDDLE_PROJECT_ID: projectId, FRAMEHUDDLE_EXPORT_ID: exportId };
  await assert.rejects(run(["comments", "delete", rootId], env, result.io, dir), /requires --yes/);
  await assert.rejects(run(["comments", "add", "--screen", "welcome", "--body", "Hi", "--x", "2", "--y", "0"], env, result.io, dir));
  assert.equal(calls.length, 0);
  await run(["comments", "reply", rootId, "--body", "Done", "--json"], env, result.io, dir);
  assert.equal(JSON.parse(result.out[0]).id, replyId);
  await run(["screens", "get", "welcome", "--output", "screen.png"], env, result.io, dir);
  assert.deepEqual(await readFile(join(dir, "screen.png")), png);
  await assert.rejects(run(["screens", "get", "welcome", "--output", "screen.png"], env, result.io, dir), /EEXIST/);
});

test("client does not follow HTTP redirects with credentials", async t => {
  let received = false;
  const target = await server(t, (_req, res) => { received = true; res.end("{}"); });
  const origin = await server(t, (_req, res) => { res.writeHead(307, { Location: `${target}/projects` }); res.end(); });
  await assert.rejects(new Client(origin, "secret").request("projects"), /Request failed/);
  assert.equal(received, false);
});

test("API failures preserve their status when the JSON body is null or not an object", async () => {
  for (const body of [null, [], "unavailable", 42]) {
    const client = new Client("https://framehuddle.com", "test-key", { fetch: (async () => json(body, 503)) as typeof fetch });
    await assert.rejects(client.request("projects"), error => {
      assert.equal((error as { status: number }).status, 503);
      assert.match(String(error), /HTTP 503/);
      return true;
    });
  }
});

test("feedback uses the current root pin when replies arrive on an earlier page", async t => {
  const dir = await temporary(t), result = capture();
  const origin = await server(t, (req, res) => {
    const data = !req.url!.includes("/comments")
      ? { export: { version: "v1" }, screens: [{ id: "welcome", title: "Welcome", section: [], width: 100, height: 200 }] }
      : req.url!.includes("cursor=")
        ? { items: [{ id: rootId, parentId: null, screenId: "welcome", x: .7, y: .8 }], nextCursor: null }
        : { items: [{ id: replyId, parentId: rootId, screenId: "welcome", x: .1, y: .2 }], nextCursor: rootId };
    res.end(JSON.stringify(data));
  });
  await run(["feedback", "--json"], { FRAMEHUDDLE_URL: origin, FRAMEHUDDLE_API_KEY: "test-key", FRAMEHUDDLE_PROJECT_ID: projectId, FRAMEHUDDLE_EXPORT_ID: exportId }, result.io, dir);
  const { comments } = JSON.parse(result.out[0]);
  assert.equal(comments.length, 2);
  for (const comment of comments) assert.deepEqual([comment.x, comment.y, comment.pixelX, comment.pixelY], [.7, .8, 70, 160]);
});

test("reply accepts uppercase UUIDs and sends the canonical root ID", async t => {
  const dir = await temporary(t), result = capture();
  const id = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
  const origin = await server(t, async (req, res) => {
    if (req.method === "GET") res.end(JSON.stringify({ items: [{ id, parentId: null, screenId: "welcome", x: .2, y: .3 }], nextCursor: null }));
    else {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      assert.equal(JSON.parse(Buffer.concat(chunks).toString()).parentId, id);
      res.end(JSON.stringify({ id: replyId }));
    }
  });
  await run(["comments", "reply", id.toUpperCase(), "--body", "Thanks"], { FRAMEHUDDLE_URL: origin, FRAMEHUDDLE_API_KEY: "test-key", FRAMEHUDDLE_PROJECT_ID: projectId, FRAMEHUDDLE_EXPORT_ID: exportId }, result.io, dir);
  assert.equal(JSON.parse(result.out[0]).id, replyId);
});

test("history feedback uses the referenced screenshot and its root pin for replies", async t => {
  const dir = await temporary(t), result = capture();
  const reference = {exportId:"33333333-3333-4333-8333-333333333333",version:"v1",screenTitle:"Original welcome",section:["Earlier flow"],width:320,height:640,imageUrl:"/earlier/welcome.png"};
  const origin = await server(t, async (req,res) => {
    res.end(JSON.stringify(req.url?.includes('/comments') ? {items:[
      {id:rootId,parentId:null,screenId:"welcome",x:.25,y:.75,referenceExportId:reference.exportId,reference},
      {id:replyId,parentId:rootId,screenId:"welcome",x:.1,y:.1,referenceExportId:reference.exportId,reference},
    ],nextCursor:null} : {export:{version:"v2"},screens:[{id:"welcome",title:"Current welcome",width:400,height:800,section:["Current flow"],imageUrl:"/current/welcome.png"}]}));
  });
  await run(["feedback","--json"],{FRAMEHUDDLE_URL:origin,FRAMEHUDDLE_API_KEY:"test-key",FRAMEHUDDLE_PROJECT_ID:projectId,FRAMEHUDDLE_EXPORT_ID:exportId},result.io,dir);
  for(const comment of JSON.parse(result.out[0]).comments){
    assert.deepEqual([comment.pixelX,comment.pixelY,comment.width,comment.height],[80,480,320,640]);
    assert.equal(comment.imageUrl,reference.imageUrl);assert.equal(comment.screenTitle,reference.screenTitle);
    assert.deepEqual(comment.section,reference.section);
  }
});
