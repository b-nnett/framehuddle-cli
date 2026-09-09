import { run } from "./commands";
import { APIError } from "./client";

process.stdout.on("error", error => {
  if ((error as NodeJS.ErrnoException).code === "EPIPE") process.exit(0);
  throw error;
});

run(process.argv.slice(2)).catch(error => {
  let message = error instanceof Error ? error.message : "Command failed.";
  for (const key of [process.env.FRAMEHUDDLE_API_KEY, process.env.VF_API_KEY])
    if (key) message = message.replaceAll(key, "[redacted]");
  console.error(process.argv.includes("--json") ? JSON.stringify({ error: message,
    ...(error instanceof APIError ? { status: error.status } : {}),
  }) : `framehuddle: ${message}`);
  process.exitCode = 1;
});
