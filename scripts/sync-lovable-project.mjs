import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { LovableClient } from "@lovable.dev/sdk";

const apiKey = process.env.LOVABLE_API_KEY;
const projectId = process.env.LOVABLE_PROJECT_ID;
const ref = process.env.LOVABLE_SYNC_REF || "main";
const strictMode = process.env.LOVABLE_SYNC_STRICT === "true";
const rawPrefixes = process.env.LOVABLE_SYNC_PREFIXES || "src/integrations/lovable/";
const prefixes = rawPrefixes
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean)
  .map((v) => (v.endsWith("/") ? v : `${v}/`));

function log(msg) {
  console.log(`[lovable-sync] ${msg}`);
}

if (!apiKey || !projectId) {
  const msg =
    "Skipping sync: LOVABLE_API_KEY or LOVABLE_PROJECT_ID is not set. Configure repo secrets to enable lovable.dev sync.";
  if (strictMode) {
    throw new Error(msg);
  }
  log(msg);
  process.exit(0);
}

const client = new LovableClient({ apiKey });
const root = process.cwd();

let resolvedRef = ref;
let listed;
try {
  listed = await client.listFiles(projectId, resolvedRef);
} catch (error) {
  if (strictMode || resolvedRef === "main") {
    throw error;
  }
  log(`Ref '${resolvedRef}' not found or unreadable, falling back to 'main'.`);
  resolvedRef = "main";
  listed = await client.listFiles(projectId, resolvedRef);
}

const selected = listed.files
  .filter(
  (f) => !f.binary && prefixes.some((prefix) => f.path.startsWith(prefix)),
  )
  .sort((a, b) => a.path.localeCompare(b.path));

if (selected.length === 0) {
  const msg = `No matching text files found at ref '${ref}' for prefixes: ${prefixes.join(", ")}`;
  if (strictMode) {
    throw new Error(msg);
  }
  log(msg);
  process.exit(0);
}

for (const file of selected) {
  const normalized = path.posix.normalize(file.path);
  if (normalized.startsWith("../") || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe remote path refused: ${file.path}`);
  }

  const content = await client.readFile(projectId, normalized, resolvedRef);
  const target = path.join(root, normalized);

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  log(`Updated ${normalized}`);
}

log(`Sync completed. Updated ${selected.length} file(s) from lovable.dev project ${projectId} @ ${resolvedRef}.`);
