import { createHash } from "node:crypto";
import {
  access,
  appendFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const configPath = path.join(rootDir, "harness.toml");
export const distRoot = path.join(rootDir, "dist");
export const reportsRoot = path.join(rootDir, "reports");

const DUPLICATE_COPY_PATTERN = / \d+(?=(\.[^/.]+)?$)/;

export const toPosix = (value) => value.split(path.sep).join("/");

const stripComment = (line) => {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString && char === "#") {
      return line.slice(0, index);
    }
  }

  return line;
};

const parseTomlValue = (rawValue) => {
  const value = rawValue.trim();

  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(",")
      .map((item) => parseTomlValue(item.trim()))
      .filter((item) => item !== "");
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
  }

  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
};

export const parseHarnessToml = (contents) => {
  const config = { project: {}, distribution: {}, apps: [] };
  let section = null;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }

    if (line === "[[apps]]") {
      const app = {};
      config.apps.push(app);
      section = app;
      continue;
    }

    const tableMatch = line.match(/^\[([A-Za-z0-9_-]+)\]$/);
    if (tableMatch) {
      const name = tableMatch[1];
      if (!config[name]) {
        config[name] = {};
      }
      section = config[name];
      continue;
    }

    const keyValue = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!keyValue || !section) {
      throw new Error(`Unsupported harness.toml line: ${rawLine}`);
    }

    section[keyValue[1]] = parseTomlValue(keyValue[2]);
  }

  return normalizeConfig(config);
};

const normalizeConfig = (config) => {
  const project = {
    name: config.project.name ?? "tauri-shinylive-harness",
    version: config.project.version ?? "0.0.0",
    portalTitle: config.project.portal_title ?? "Clinical Shinylive Portal",
    portalSubtitle: config.project.portal_subtitle ?? "Localhost runtime harness",
    bundleName: config.project.bundle_name ?? "Clinical Shinylive Desktop Portal",
  };

  const distribution = {
    artifactName: config.distribution.artifact_name ?? project.name,
    releaseChannel: config.distribution.release_channel ?? "internal",
    releaseDraft: Boolean(config.distribution.release_draft ?? true),
    requireOffline: Boolean(config.distribution.require_offline ?? true),
    macBundles: Array.isArray(config.distribution.mac_bundles)
      ? config.distribution.mac_bundles
      : ["app"],
    githubRepo: config.distribution.github_repo ?? "",
  };

  const phase3 = {
    signingRequired: Boolean(config.phase3?.signing_required ?? false),
    notarizationRequired: Boolean(config.phase3?.notarization_required ?? false),
    validationPackRequired: Boolean(config.phase3?.validation_pack_required ?? true),
    releaseDraftDefault: Boolean(config.phase3?.release_draft_default ?? true),
  };

  const apps = config.apps.map((app) => ({
    id: app.id,
    title: app.title ?? app.id,
    description: app.description ?? "",
    kind: app.kind ?? "shinylive-r",
    source: app.source ?? `shinylive-src/${app.id}`,
    output: app.output ?? `apps/${app.id}`,
    path: app.path ?? `/apps/${app.id}/index.html`,
    offlineRequired: Boolean(app.offline_required ?? true),
    smokeText: Array.isArray(app.smoke_text) ? app.smoke_text : [],
    headerProbes: Array.isArray(app.header_probes) ? app.header_probes : ["index.html"],
    domProbes: Array.isArray(app.dom_probes) ? app.dom_probes : [],
    dataPack: app.data_pack ?? "",
    dataPaths: Array.isArray(app.data_paths) ? app.data_paths : [],
  }));

  const ids = new Set();
  for (const app of apps) {
    if (!app.id) {
      throw new Error("Every [[apps]] entry needs an id.");
    }
    if (ids.has(app.id)) {
      throw new Error(`Duplicate app id in harness.toml: ${app.id}`);
    }
    ids.add(app.id);
  }

  return { project, distribution, phase3, apps };
};

export const readConfig = async () => parseHarnessToml(await readFile(configPath, "utf8"));

const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

const createDataPackManifest = async (app) => {
  if (!app.dataPack && app.dataPaths.length === 0) {
    return null;
  }

  const files = [];
  for (const relativePath of app.dataPaths) {
    const targetPath = path.join(rootDir, relativePath);
    const metadata = await stat(targetPath);
    files.push({
      path: toPosix(relativePath),
      size: metadata.size,
      sha256: await sha256File(targetPath),
    });
  }

  const fingerprint = files
    .map((file) => `${file.path}\0${file.size}\0${file.sha256}`)
    .join("\n");

  return {
    id: app.dataPack || `${app.id}-data`,
    sha256: sha256Text(fingerprint),
    fileCount: files.length,
    files,
  };
};

export const appToManifest = async (app) => {
  const manifest = {
    id: app.id,
    title: app.title,
    path: app.path,
    description: app.description,
    kind: app.kind,
    offlineRequired: app.offlineRequired,
    source: app.source,
    output: app.output,
    smokeText: app.smokeText,
    headerProbes: app.headerProbes.map((probe) =>
      probe.startsWith("/") ? probe : `${app.path.replace(/\/index\.html$/, "")}/${probe}`,
    ),
    domProbes: app.domProbes,
  };

  const dataPack = await createDataPackManifest(app);
  if (dataPack) {
    manifest.dataPack = dataPack;
  }

  return manifest;
};

export const createPortalManifest = (config, appManifests) => ({
  schemaVersion: 2,
  generatedBy: "tauri-shinylive-harness",
  project: config.project,
  distribution: config.distribution,
  phase3: config.phase3,
  apps: appManifests,
});

export const exists = async (targetPath) => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const readJson = async (targetPath) => JSON.parse(await readFile(targetPath, "utf8"));

export const writeJson = async (targetPath, value) => {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
};

const shouldCopy = (relativePath) => {
  const basename = path.basename(relativePath);
  return !DUPLICATE_COPY_PATTERN.test(basename) && basename !== ".DS_Store";
};

const copyFiltered = async (source, destination, relative = "") => {
  const sourcePath = path.join(source, relative);
  const destinationPath = path.join(destination, relative);
  const metadata = await stat(sourcePath);

  if (metadata.isDirectory()) {
    await mkdir(destinationPath, { recursive: true });
    for (const entry of await readdir(sourcePath)) {
      const nextRelative = path.join(relative, entry);
      if (shouldCopy(nextRelative)) {
        await copyFiltered(source, destination, nextRelative);
      }
    }
    return;
  }

  if (metadata.isFile() && shouldCopy(relative)) {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, { force: true });
  }
};

export const prepareDist = async (config = null) => {
  const nextConfig = config ?? (await readConfig());
  const appsSource = path.join(rootDir, "apps");
  const appsDist = path.join(distRoot, "apps");
  const portalDist = path.join(distRoot, "portal");
  const appManifests = [];

  await mkdir(distRoot, { recursive: true });
  await rm(appsDist, { recursive: true, force: true });
  await copyFiltered(appsSource, appsDist);

  if (!(await exists(portalDist))) {
    throw new Error("Portal build is missing. Run npm run build:portal first.");
  }

  for (const app of nextConfig.apps) {
    const manifestPath = path.join(rootDir, app.output, "harness-app.json");
    if (!(await exists(manifestPath))) {
      throw new Error(`Missing app manifest: ${path.relative(rootDir, manifestPath)}`);
    }
    appManifests.push(await readJson(manifestPath));
  }

  const manifest = createPortalManifest(nextConfig, appManifests);
  await writeJson(path.join(distRoot, "manifest.json"), manifest);
  await writeBundleArtifacts(nextConfig, manifest);
  await writeVerificationProcedure(nextConfig);

  return manifest;
};

export const listFiles = async (basePath, relative = "") => {
  const current = path.join(basePath, relative);
  const metadata = await stat(current);

  if (metadata.isDirectory()) {
    const files = [];
    for (const entry of await readdir(current)) {
      files.push(...(await listFiles(basePath, path.join(relative, entry))));
    }
    return files;
  }

  if (!metadata.isFile()) {
    return [];
  }

  return [relative];
};

export const sha256File = async (targetPath) => {
  const hash = createHash("sha256");
  hash.update(await readFile(targetPath));
  return hash.digest("hex");
};

export const writeBundleArtifacts = async (config, manifest) => {
  const files = (await listFiles(distRoot))
    .filter((file) => !file.startsWith(`reports${path.sep}`))
    .filter((file) => file !== "harness-bundle-manifest.json")
    .filter((file) => file !== path.join("checksums", "SHA256SUMS"))
    .sort();
  const assets = [];

  for (const relativePath of files) {
    const targetPath = path.join(distRoot, relativePath);
    const metadata = await stat(targetPath);
    assets.push({
      path: toPosix(relativePath),
      size: metadata.size,
      sha256: await sha256File(targetPath),
    });
  }

  const bundleManifest = {
    schemaVersion: 1,
    project: config.project,
    distribution: config.distribution,
    appCount: manifest.apps.length,
    assets,
  };

  await writeJson(path.join(distRoot, "harness-bundle-manifest.json"), bundleManifest);
  await mkdir(path.join(distRoot, "checksums"), { recursive: true });
  await writeFile(
    path.join(distRoot, "checksums", "SHA256SUMS"),
    `${assets.map((asset) => `${asset.sha256}  ${asset.path}`).join("\n")}\n`,
  );
  await writeJson(path.join(distRoot, "reports", "sbom.json"), createSbom(config, assets));
  await writeFile(path.join(distRoot, "reports", "licenses.md"), await createLicenseReport(config));

  return bundleManifest;
};

const createSbom = (config, assets) => ({
  schemaVersion: 1,
  generatedBy: "tauri-shinylive-harness",
  project: config.project,
  components: assets.map((asset) => ({
    type: "file",
    name: asset.path,
    hashes: [{ alg: "SHA-256", content: asset.sha256 }],
    size: asset.size,
  })),
});

const npmPackages = async () => {
  const packageLock = await readJson(path.join(rootDir, "package-lock.json"));
  return Object.entries(packageLock.packages ?? {})
    .filter(([packagePath]) => packagePath.startsWith("node_modules/"))
    .map(([packagePath, metadata]) => ({
      name: packagePath.replace(/^node_modules\//, ""),
      version: metadata.version ?? "unknown",
      license: metadata.license ?? "unknown",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const cargoPackages = async (lockPath) => {
  const text = await readFile(lockPath, "utf8");
  const packages = [];
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    if (line === "[[package]]") {
      if (current) {
        packages.push(current);
      }
      current = {};
    } else if (current && line.startsWith("name = ")) {
      current.name = parseTomlValue(line.replace("name = ", ""));
    } else if (current && line.startsWith("version = ")) {
      current.version = parseTomlValue(line.replace("version = ", ""));
    }
  }
  if (current) {
    packages.push(current);
  }

  return packages
    .filter((pkg) => pkg.name && pkg.version)
    .map((pkg) => ({ ...pkg, license: "unknown" }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const createLicenseReport = async (config) => {
  const npm = await npmPackages();
  const tauriCargo = await cargoPackages(path.join(rootDir, "src-tauri", "Cargo.lock"));
  const serverCargo = await cargoPackages(path.join(rootDir, "crates", "harness-server", "Cargo.lock"));

  return [
    "# License Inventory",
    "",
    `Project: ${config.project.name} ${config.project.version}`,
    "",
    "This inventory is generated from lockfiles. Cargo package licenses are listed as unknown until a dedicated cargo-license step is added.",
    "",
    "## npm",
    "",
    "| Package | Version | License |",
    "| --- | --- | --- |",
    ...npm.map((pkg) => `| ${pkg.name} | ${pkg.version} | ${pkg.license} |`),
    "",
    "## Cargo: Tauri Shell",
    "",
    "| Package | Version | License |",
    "| --- | --- | --- |",
    ...tauriCargo.map((pkg) => `| ${pkg.name} | ${pkg.version} | ${pkg.license} |`),
    "",
    "## Cargo: Harness Server",
    "",
    "| Package | Version | License |",
    "| --- | --- | --- |",
    ...serverCargo.map((pkg) => `| ${pkg.name} | ${pkg.version} | ${pkg.license} |`),
    "",
  ].join("\n");
};

export const verifyBundleArtifacts = async (config = null) => {
  const nextConfig = config ?? (await readConfig());
  const bundleManifestPath = path.join(distRoot, "harness-bundle-manifest.json");
  const manifestPath = path.join(distRoot, "manifest.json");
  const bundleManifest = await readJson(bundleManifestPath);
  const portalManifest = await readJson(manifestPath);
  const issues = [];

  if (portalManifest.apps.length !== nextConfig.apps.length) {
    issues.push(`Expected ${nextConfig.apps.length} apps but manifest has ${portalManifest.apps.length}.`);
  }

  for (const app of nextConfig.apps) {
    const match = portalManifest.apps.find((candidate) => candidate.id === app.id);
    if (!match) {
      issues.push(`Missing app in portal manifest: ${app.id}`);
      continue;
    }
    for (const probe of match.headerProbes ?? []) {
      const relativeProbe = probe.replace(/^\//, "");
      if (!(await exists(path.join(distRoot, relativeProbe)))) {
        issues.push(`Missing header probe target: ${probe}`);
      }
    }
  }

  for (const asset of bundleManifest.assets) {
    const targetPath = path.join(distRoot, asset.path);
    if (!(await exists(targetPath))) {
      issues.push(`Missing bundled asset: ${asset.path}`);
      continue;
    }
    const nextHash = await sha256File(targetPath);
    if (nextHash !== asset.sha256) {
      issues.push(`Hash mismatch: ${asset.path}`);
    }
  }

  const report = {
    schemaVersion: 1,
    ok: issues.length === 0,
    project: nextConfig.project,
    checkedAt: new Date().toISOString(),
    appCount: portalManifest.apps.length,
    assetCount: bundleManifest.assets.length,
    issues,
  };

  await writeJson(path.join(reportsRoot, "static-verification.json"), report);
  await appendAudit("verify-static", report.ok ? "ok" : "failed", report);

  if (issues.length > 0) {
    throw new Error(`Static verification failed:\n${issues.join("\n")}`);
  }

  return report;
};

export const writeVerificationProcedure = async (config) => {
  const lines = [
    "# Verification Procedure",
    "",
    "This procedure is generated from `harness.toml` and covers Phase 2 verification plus Phase 3 release readiness.",
    "",
    "## Phase 2 Commands",
    "",
    "1. `npm ci`",
    "2. `node scripts/harness.mjs validate-data`",
    "3. `node scripts/harness.mjs export`",
    "4. `node scripts/harness.mjs prepare`",
    "5. `node scripts/harness.mjs verify-static`",
    "6. `node scripts/e2e-verify.mjs`",
    "7. `npm run tauri:build`",
    "",
    "## Phase 3 Commands",
    "",
    "1. `npm run phase3:preflight`",
    "2. `npm run tauri:build:app:no-sign` for an unsigned internal release candidate.",
    "3. `npm run tauri:build:app` after Apple signing and notarization credentials are configured.",
    "4. `npm run phase3:package`",
    "5. `npm run phase3:release-draft` after the release has been reviewed.",
    "",
    "## Acceptance Criteria",
    "",
    "- Portal manifest lists every app from `harness.toml`.",
    "- COOP, COEP, CORP, Service-Worker-Allowed, and MIME headers pass for configured probes.",
    "- The browser reports SharedArrayBuffer availability and cross-origin isolation.",
    "- Each app exposes its configured smoke text in a same-origin iframe.",
    "- Configured DOM probes are visible, including lab trend and exposure/AE timeline plots.",
    "- Clinical data pack validation passes with zero errors.",
    "- `reports/clinical-data-pack-validation.json` and `docs/generated/clinical-data-dictionary.md` are generated.",
    "- Playwright screenshot evidence is generated for the portal and verified apps.",
    "- E2E network audit observes no external HTTP(S) requests.",
    "- `dist/harness-bundle-manifest.json` hashes match bundled files.",
    "- `dist/checksums/SHA256SUMS` is generated.",
    "- `dist/reports/sbom.json` and `dist/reports/licenses.md` are generated.",
    "- `reports/phase3-preflight.json` records signing, notarization, GitHub, and tooling readiness.",
    "- `release/` contains an app archive, optional DMG, release notes, checksums, and validation pack.",
    "- Public release publication is held until Apple credentials and organization approval are present.",
    "",
    "## Apps",
    "",
    "| App | Kind | Data Pack | Smoke Text |",
    "| --- | --- | --- | --- |",
    ...config.apps.map(
      (app) => `| ${app.id} | ${app.kind} | ${app.dataPack || "n/a"} | ${app.smokeText.join("<br>")} |`,
    ),
    "",
  ];

  await mkdir(path.join(rootDir, "docs", "generated"), { recursive: true });
  await writeFile(path.join(rootDir, "docs", "generated", "verification-procedure.md"), `${lines.join("\n")}\n`);
};

export const appendAudit = async (action, status, details = {}) => {
  await mkdir(reportsRoot, { recursive: true });
  await appendFile(
    path.join(reportsRoot, "audit-log.jsonl"),
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      action,
      status,
      details,
    })}\n`,
  );
};

export const runCommand = async (command, args, options = {}) => {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
};
