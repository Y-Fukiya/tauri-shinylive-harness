import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "dist");
const appsSource = path.join(root, "apps");
const appsDist = path.join(distRoot, "apps");

const appManifestPath = path.join(appsSource, "subject-safety-mini", "harness-app.json");
const appManifest = JSON.parse(await readFile(appManifestPath, "utf8"));

await mkdir(distRoot, { recursive: true });
await rm(appsDist, { recursive: true, force: true });
await cp(appsSource, appsDist, { recursive: true });

const manifest = {
  schemaVersion: 1,
  generatedBy: "tauri-shinylive-harness",
  apps: [appManifest]
};

await writeFile(path.join(distRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
