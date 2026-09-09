import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { commentSchema, projectSchema, stableId, uuid } from "./schema";
import type { Comment, LoadedExport } from "./types";
import { Client } from "./client";
import { importExport, readExport } from "./import";
import pkg from "../package.json";

export const help = `Framehuddle CLI ${pkg.version}

Usage: framehuddle <command> [options]

  init --project ID [--export ID]         Save local project/export defaults
  projects list                          List all accessible projects
  projects get [ID]                       Read a project
  projects create --name NAME [--description TEXT]
  projects update --name NAME [--description TEXT]
  projects archive --yes                 Archive the selected project
  exports list                           List all published versions
  exports get [ID]                        Read an export manifest
  exports validate FILE                   Validate an import locally
  exports import FILE                    Upload and publish an export
  feedback [--status open|resolved]       All comments with frame/pin context
  comments list [--status open|resolved]  All comments, without frame lookup
  comments add --screen ID --body TEXT --x 0..1 --y 0..1
  comments reply ID --body TEXT           Reply to a root thread
  comments edit ID --body TEXT            Edit your own comment
  comments resolve ID                    Resolve a root thread
  comments reopen ID                     Reopen a root thread
  comments delete ID --yes               Delete your own comment
  screens get ID --output FILE           Download an original screenshot

Global options:
  --project ID       Project ID (or FRAMEHUDDLE_PROJECT_ID)
  --export ID        Export ID (or FRAMEHUDDLE_EXPORT_ID)
  --url ORIGIN       API origin (default https://framehuddle.com)
  --config FILE      Local defaults (default ./framehuddle.config.json)
  --json            JSON stdout, including errors on stderr
  --help, -h        Show this help
  --version, -v     Show version

Set FRAMEHUDDLE_API_KEY to a scoped API key from Framehuddle Settings.
FRAMEHUDDLE_URL, VF_URL and VF_API_KEY are supported. Credentials are
read only from the environment. Progress goes to stderr.
`;

type Config = { projectId?: string; exportId?: string };
type IO = { out: (value: string) => void; err: (value: string) => void };
const globals = ["project", "export", "url", "config", "json", "help", "version"];
const definitions: Record<string, { args: number; options?: string[] }> = {
  init: { args: 0 },
  "projects list": { args: 0 }, "projects get": { args: 1 },
  "projects create": { args: 0, options: ["name", "description"] },
  "projects update": { args: 0, options: ["name", "description"] },
  "projects archive": { args: 0, options: ["yes"] },
  "exports list": { args: 0 }, "exports get": { args: 1 },
  "exports validate": { args: 1 }, "exports import": { args: 1 },
  feedback: { args: 0, options: ["status"] },
  "comments list": { args: 0, options: ["status"] },
  "comments add": { args: 0, options: ["screen", "body", "x", "y"] },
  "comments reply": { args: 1, options: ["body"] },
  "comments edit": { args: 1, options: ["body"] },
  "comments resolve": { args: 1 }, "comments reopen": { args: 1 },
  "comments delete": { args: 1, options: ["yes"] },
  "screens get": { args: 1, options: ["output"] },
};

async function loadConfig(path: string, explicit: boolean): Promise<Config> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if (!explicit && (error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const config = JSON.parse(text);
  if (!config || typeof config !== "object" || Array.isArray(config) ||
    Object.keys(config).some(key => !["projectId", "exportId"].includes(key)))
    throw new Error("Config supports only projectId and exportId. Set credentials and API origin in the environment.");
  if (config.projectId !== undefined) uuid.parse(config.projectId);
  if (config.exportId !== undefined) uuid.parse(config.exportId);
  return config;
}

export async function run(args: string[], env: Record<string, string | undefined> = process.env,
  io: IO = { out: console.log, err: console.error }, cwd = process.cwd()) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
    json: { type: "boolean" }, yes: { type: "boolean" },
    ...Object.fromEntries(["project", "export", "url", "config", "name", "description", "status", "screen", "body", "x", "y", "output"].map(key => [key, { type: "string" as const }])),
  } });
  if (values.version) { io.out(pkg.version); return; }
  if (values.help || !positionals.length) { io.out(help); return; }
  const single = ["init", "feedback"].includes(positionals[0]);
  const command = positionals.slice(0, single ? 1 : 2).join(" ");
  const operands = positionals.slice(single ? 1 : 2);
  const definition = definitions[command];
  if (!definition) throw new Error(`Unknown command: ${command}. Run framehuddle --help.`);
  if (operands.length > definition.args) throw new Error(`Too many arguments for ${command}.`);
  for (const key of Object.keys(values)) {
    if (!globals.includes(key) && !definition.options?.includes(key))
      throw new Error(`--${key} is not supported by ${command}.`);
  }
  const options: Record<string, string | boolean | undefined> = values;
  const option = (key: string): string | undefined => typeof options[key] === "string" ? options[key] as string : undefined;
  const required = (key: string): string => {
    const value = option(key);
    if (!value?.trim()) throw new Error(`Provide --${key}.`);
    return value;
  };
  const operand = () => {
    if (!operands[0]) throw new Error(`Provide ${definition.args ? "an argument" : "a value"} for ${command}.`);
    return operands[0];
  };
  const output = (data: unknown) => {
    if (!values.json && Array.isArray(data)) {
      if (!data.length) { io.out("No results."); return; }
      io.out(data.map(item => JSON.stringify(item)).join("\n"));
    } else io.out(JSON.stringify(data ?? { ok: true }, null, 2));
  };
  if (command === "exports validate") {
    const { manifest, images, bytes } = await readExport(resolve(cwd, operand()));
    output({ valid: true, version: manifest.export.version, screenCount: images.length, bytes });
    return;
  }
  const configPath = resolve(cwd, option("config") ?? "framehuddle.config.json");
  const config = command === "init" ? {} : await loadConfig(configPath, !!option("config"));
  const projectId = option("project") ?? env.FRAMEHUDDLE_PROJECT_ID ?? config.projectId;
  const exportId = option("export") ?? env.FRAMEHUDDLE_EXPORT_ID ?? config.exportId;
  if (command === "init") {
    if (!projectId) throw new Error("Provide --project ID.");
    const defaults: Config = { projectId: uuid.parse(projectId), ...(exportId ? { exportId: uuid.parse(exportId) } : {}) };
    await writeFile(configPath, JSON.stringify(defaults, null, 2) + "\n", { flag: "wx" });
    output({ config: configPath, ...defaults });
    return;
  }
  const client = new Client(option("url") ?? env.FRAMEHUDDLE_URL ?? env.VF_URL ?? "https://framehuddle.com",
    env.FRAMEHUDDLE_API_KEY ?? env.VF_API_KEY ?? "", { progress: io.err });
  const project = (id = projectId) => {
    if (!id) throw new Error("Provide --project ID, set FRAMEHUDDLE_PROJECT_ID, or run framehuddle init.");
    return `projects/${uuid.parse(id)}`;
  };
  const exp = (id = exportId) => {
    if (!id) throw new Error("Provide --export ID or set a default with framehuddle init.");
    return `${project()}/exports/${uuid.parse(id)}`;
  };
  const status = option("status");
  if (status && !["open", "resolved"].includes(status)) throw new Error("--status must be open or resolved.");
  const query = status ? `?status=${status}` : "";
  const confirm = () => { if (!values.yes) throw new Error(`${command} requires --yes.`); };
  switch (command) {
    case "projects list": output(await client.all("projects")); break;
    case "projects get": output(await client.request(project(operands[0] ?? projectId))); break;
    case "projects create":
    case "projects update": {
      const body = projectSchema.parse({ name: required("name"), description: option("description") });
      // The API replaces both fields. Preserve the current description on a name-only update.
      if (command === "projects update" && option("description") === undefined)
        body.description = (await client.request<{ description: string }>(project())).description;
      output(await client.request(command === "projects create" ? "projects" : project(), command === "projects create" ? "POST" : "PATCH", body));
      break;
    }
    case "projects archive": confirm(); output(await client.request(project(), "DELETE")); break;
    case "exports list": output(await client.all(`${project()}/exports`)); break;
    case "exports get": output(await client.request(exp(operands[0] ?? exportId))); break;
    case "exports import": {
      project();
      output(await importExport(client, projectId!, resolve(cwd, operand()), io.err));
      break;
    }
    case "comments list": output(await client.all(`${exp()}/comments${query}`)); break;
    case "feedback": {
      const prefix = exp();
      const [manifest, comments] = await Promise.all([
        client.request<LoadedExport>(prefix), client.all<Comment>(`${prefix}/comments${query}`),
      ]);
      const screens = new Map(manifest.screens.map(screen => [screen.id, screen]));
      output({ projectId, exportId, version: manifest.export.version, comments: comments.map(comment => {
        const screen = screens.get(comment.screenId);
        return { ...comment, rootId: comment.parentId ?? comment.id,
          screenTitle: screen?.title ?? null, section: screen?.section ?? null,
          width: screen?.width ?? null, height: screen?.height ?? null,
          pixelX: screen ? Math.round(comment.x * screen.width) : null,
          pixelY: screen ? Math.round(comment.y * screen.height) : null,
          imageUrl: screen?.imageUrl ?? null };
      }) });
      break;
    }
    case "comments add": {
      const body = commentSchema.parse({ screenId: required("screen"), body: required("body"), x: Number(required("x")), y: Number(required("y")) });
      output(await client.request(`${exp()}/comments`, "POST", body));
      break;
    }
    case "comments reply": {
      const id = uuid.parse(operand());
      const body = required("body");
      const comments = await client.all<Comment>(`${exp()}/comments`);
      const root = comments.find(comment => comment.id === id);
      if (!root || root.parentId) throw new Error("Reply requires a root comment ID in the selected export.");
      output(await client.request(`${exp()}/comments`, "POST", commentSchema.parse({
        screenId: root.screenId, parentId: id, body, x: root.x, y: root.y,
      })));
      break;
    }
    case "comments edit":
    case "comments resolve":
    case "comments reopen":
    case "comments delete": {
      const id = uuid.parse(operand());
      if (command === "comments delete") {
        confirm(); output(await client.request(`${exp()}/comments/${id}`, "DELETE"));
      } else {
        const body = command === "comments edit" ? { body: commentSchema.shape.body.parse(required("body")) } : { resolved: command === "comments resolve" };
        output(await client.request(`${exp()}/comments/${id}`, "PATCH", body));
      }
      break;
    }
    case "screens get": {
      const screenId = stableId.parse(operand());
      const path = resolve(cwd, required("output"));
      const bytes = await client.image(`${exp()}/screens/${encodeURIComponent(screenId)}`);
      await writeFile(path, bytes, { flag: "wx" });
      output({ path, bytes: bytes.length });
      break;
    }
  }
}
