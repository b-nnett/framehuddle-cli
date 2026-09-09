import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { importSchema } from "./schema";
import type { Client } from "./client";

export const MAX_IMPORT_FILE_BYTES = 142_000_000;
const MAX_IMAGE_BYTES = 3_000_000;
const MAX_EXPORT_BYTES = 100_000_000;

export async function collectBounded(chunks: AsyncIterable<Uint8Array>, limit: number): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    total += chunk.byteLength;
    if (total > limit) throw new Error(`Import file exceeds the ${limit.toLocaleString("en-US")} byte input limit.`);
    parts.push(chunk);
  }
  return Buffer.concat(parts, total);
}

export async function readBoundedFile(file: string, limit = MAX_IMPORT_FILE_BYTES): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Import must be a regular file.");
    if (stat.size > limit) throw new Error(`Import file exceeds the ${limit.toLocaleString("en-US")} byte input limit.`);
    // The streaming check also enforces the limit if the file grows after stat.
    return await collectBounded(handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 }), limit);
  } finally { await handle.close(); }
}

export function imageByteLength(image: string | undefined, id: string): number {
  if (!image || image.length % 4 !== 0) throw new Error(`Missing or invalid base64 image: ${id}`);
  const padding = image.endsWith("==") ? 2 : image.endsWith("=") ? 1 : 0;
  // A single character-class search avoids recursive matching of long base64 groups.
  if (/[^A-Za-z0-9+/]/.test(image.slice(0, image.length - padding)))
    throw new Error(`Missing or invalid base64 image: ${id}`);
  return image.length / 4 * 3 - padding;
}

export function checkImageBudget(screens: { id: string; image?: string }[], maxTotal = MAX_EXPORT_BYTES): number {
  let total = 0;
  for (const screen of screens) {
    const bytes = imageByteLength(screen.image, screen.id);
    if (bytes > MAX_IMAGE_BYTES) throw new Error(`Image exceeds 3 MB: ${screen.id}`);
    total += bytes;
    if (total > maxTotal) throw new Error("Export exceeds its decoded image budget (100 MB maximum).");
  }
  return total;
}

export async function readExport(file: string) {
  // 142 MB covers 100 MB of base64-encoded images plus metadata/formatting overhead.
  const input = importSchema.parse(JSON.parse((await readBoundedFile(file)).toString("utf8")));
  const bytes = checkImageBudget(input.screens);
  const images = input.screens.map(screen => {
    const bytes = Buffer.from(screen.image!, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== screen.sha256)
      throw new Error(`Checksum mismatch: ${screen.id}`);
    return bytes;
  });
  const manifest = { ...input, screens: input.screens.map(({ image, ...screen }) => screen) };
  return { manifest, images, bytes };
}

export async function importExport(client: Client, projectId: string, file: string, progress: (message: string) => void) {
  const { manifest, images, bytes } = await readExport(file);
  const prefix = `projects/${encodeURIComponent(projectId)}/exports`;
  const draft = await client.request<{ id: string; status: string }>(prefix, "POST", manifest);
  if (!draft.id || !["draft", "ready"].includes(draft.status)) throw new Error("Invalid export response.");
  if (draft.status !== "ready") {
    let next = 0;
    let failed = false;
    const workers = await Promise.allSettled(Array.from({ length: Math.min(3, images.length) }, async () => {
      while (!failed && next < images.length) {
        const index = next++;
        const screen = manifest.screens[index];
        try {
          await client.request(`${prefix}/${encodeURIComponent(draft.id)}/screens/${encodeURIComponent(screen.id)}`, "PUT", images[index]);
          progress(`Uploaded ${screen.id}`);
        } catch (error) { failed = true; throw error; }
      }
    }));
    const failure = workers.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    await client.request(`${prefix}/${encodeURIComponent(draft.id)}/complete`, "POST");
  }
  return { id: draft.id, status: "ready", version: manifest.export.version, screenCount: images.length, bytes };
}
