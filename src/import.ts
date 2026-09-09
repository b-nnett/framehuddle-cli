import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { importSchema } from "./schema";
import type { Client } from "./client";

export async function readExport(file: string) {
  const input = importSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const images = input.screens.map(screen => {
    if (!screen.image || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(screen.image))
      throw new Error(`Missing or invalid base64 image: ${screen.id}`);
    const bytes = Buffer.from(screen.image, "base64");
    if (bytes.length > 3_000_000) throw new Error(`Image exceeds 3 MB: ${screen.id}`);
    if (createHash("sha256").update(bytes).digest("hex") !== screen.sha256)
      throw new Error(`Checksum mismatch: ${screen.id}`);
    return bytes;
  });
  const bytes = images.reduce((total, image) => total + image.length, 0);
  if (bytes > 100_000_000) throw new Error("Export exceeds 100 MB.");
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
