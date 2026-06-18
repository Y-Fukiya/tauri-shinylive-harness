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
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const configPath = path.join(rootDir, "harness.toml");
export const configSchemaPath = path.join(rootDir, "schemas", "harness.schema.json");
export const distRoot = path.join(rootDir, "dist");
export const reportsRoot = path.join(rootDir, "reports");

const DUPLICATE_COPY_PATTERN = / \d+(?=(\.[^/.]+)?$)/;
const WINDOWS_COMMAND_SHIMS = new Map([
  ["npm", "npm.cmd"],
  ["npx", "npx.cmd"],
]);

export const toPosix = (value) => value.split(path.sep).join("/");

export const commandForPlatform = (command) =>
  process.platform === "win32" && WINDOWS_COMMAND_SHIMS.has(command)
    ? WINDOWS_COMMAND_SHIMS.get(command)
    : command;

const shouldUseShellForPlatform = (command) =>
  process.platform === "win32" &&
  (WINDOWS_COMMAND_SHIMS.has(command) || /\.(?:cmd|bat)$/i.test(command));

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

const splitTomlArrayItems = (inner) => {
  const items = [];
  let current = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      current += char;
      inString = !inString;
      continue;
    }
    if (char === "," && !inString) {
      const item = current.trim();
      if (!item) {
        throw new Error("Invalid TOML array: empty array item.");
      }
      items.push(item);
      current = "";
      continue;
    }
    current += char;
  }

  if (inString) {
    throw new Error("Invalid TOML array: unterminated string.");
  }

  const item = current.trim();
  if (item) {
    items.push(item);
  }

  return items;
};

const unescapeTomlString = (value) =>
  value.replace(/\\(["\\nrtbf])/g, (_match, char) => {
    const escapes = {
      '"': '"',
      "\\": "\\",
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
    };
    return escapes[char];
  });

const parseTomlValue = (rawValue) => {
  const value = rawValue.trim();

  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return splitTomlArrayItems(inner).map((item) => parseTomlValue(item));
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return unescapeTomlString(value.slice(1, -1));
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

const logicalDataPackPath = (app, relativePath) => {
  const normalizedPath = toPosix(relativePath);
  const metadataPath = app.dataPaths.find((candidate) => candidate.endsWith("clinical-demo-data-pack.json"));
  const dataRoot = metadataPath
    ? toPosix(path.posix.dirname(toPosix(metadataPath)))
    : toPosix(path.posix.dirname(normalizedPath));
  const prefix = `${dataRoot}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : path.posix.basename(normalizedPath);
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
    windowsBundles: Array.isArray(config.distribution.windows_bundles)
      ? config.distribution.windows_bundles
      : ["nsis"],
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
    reportTemplates: Array.isArray(app.report_templates) ? app.report_templates : [],
    dataPack: app.data_pack ?? "",
    dataPackSource: app.data_pack_source ?? "",
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

const issue = (issues, severity, code, message, details = {}) => {
  issues.push({ severity, code, message, details });
};

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const validateStringField = (issues, field, value) => {
  if (!isNonEmptyString(value)) {
    issue(issues, "error", "required-string", `${field} must be a non-empty string.`, { field });
  }
};

const validateRelativePath = (issues, field, value, { prefix = null } = {}) => {
  validateStringField(issues, field, value);
  if (!isNonEmptyString(value)) {
    return;
  }
  if (path.isAbsolute(value) || value.includes("..") || value.includes("\0") || value.includes("\\")) {
    issue(issues, "error", "invalid-relative-path", `${field} must be a repository-relative POSIX path.`, {
      field,
      value,
    });
  }
  if (prefix && !value.startsWith(prefix)) {
    issue(issues, "warning", "unexpected-path-prefix", `${field} should normally start with ${prefix}.`, {
      field,
      value,
      prefix,
    });
  }
};

const validateStringArray = (issues, field, value, { minLength = 0 } = {}) => {
  if (!Array.isArray(value)) {
    issue(issues, "error", "array-required", `${field} must be an array.`, { field });
    return;
  }
  if (value.length < minLength) {
    issue(issues, "error", "array-too-short", `${field} must include at least ${minLength} item(s).`, {
      field,
      minLength,
    });
  }
  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item)) {
      issue(issues, "error", "array-item-string-required", `${field}[${index}] must be a non-empty string.`, {
        field,
        index,
      });
    }
  }
};

export const validateHarnessConfig = async (
  config = null,
  { reportPath = path.join(reportsRoot, "harness-config-validation.json"), writeOutputs = true } = {},
) => {
  const nextConfig = config ?? (await readConfig());
  const issues = [];

  validateStringField(issues, "project.name", nextConfig.project.name);
  validateStringField(issues, "project.portalTitle", nextConfig.project.portalTitle);
  validateStringField(issues, "project.bundleName", nextConfig.project.bundleName);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(nextConfig.project.version)) {
    issue(issues, "error", "invalid-version", "project.version must be semantic-version-like.", {
      version: nextConfig.project.version,
    });
  }

  validateStringField(issues, "distribution.artifactName", nextConfig.distribution.artifactName);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(nextConfig.distribution.artifactName)) {
    issue(
      issues,
      "error",
      "invalid-artifact-name",
      "distribution.artifactName must use lowercase letters, numbers, dots, underscores, or hyphens.",
      { artifactName: nextConfig.distribution.artifactName },
    );
  }
  validateStringField(issues, "distribution.releaseChannel", nextConfig.distribution.releaseChannel);
  validateStringArray(issues, "distribution.macBundles", nextConfig.distribution.macBundles, { minLength: 1 });
  for (const bundle of nextConfig.distribution.macBundles) {
    if (!["app", "dmg", "pkg"].includes(bundle)) {
      issue(issues, "error", "unsupported-mac-bundle", "distribution.macBundles may contain only app, dmg, or pkg.", {
        bundle,
      });
    }
  }
  validateStringArray(issues, "distribution.windowsBundles", nextConfig.distribution.windowsBundles, { minLength: 1 });
  for (const bundle of nextConfig.distribution.windowsBundles) {
    if (!["nsis", "msi"].includes(bundle)) {
      issue(issues, "error", "unsupported-windows-bundle", "distribution.windowsBundles may contain only nsis or msi.", {
        bundle,
      });
    }
  }
  if (
    nextConfig.distribution.githubRepo &&
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(nextConfig.distribution.githubRepo)
  ) {
    issue(issues, "error", "invalid-github-repo", "distribution.githubRepo must look like owner/repo.", {
      githubRepo: nextConfig.distribution.githubRepo,
    });
  }

  if (nextConfig.apps.length === 0) {
    issue(issues, "error", "no-apps", "harness.toml must configure at least one app.");
  }

  const ids = new Set();
  for (const app of nextConfig.apps) {
    const prefix = `apps.${app.id || "<missing>"}`;
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(app.id ?? "")) {
      issue(issues, "error", "invalid-app-id", "App id must use lowercase letters, numbers, dots, underscores, or hyphens.", {
        appId: app.id,
      });
    }
    if (ids.has(app.id)) {
      issue(issues, "error", "duplicate-app-id", "App ids must be unique.", { appId: app.id });
    }
    ids.add(app.id);

    validateStringField(issues, `${prefix}.title`, app.title);
    validateStringField(issues, `${prefix}.kind`, app.kind);
    if (!["shinylive-r", "shinylive-python"].includes(app.kind)) {
      issue(issues, "warning", "unknown-app-kind", "App kind is not one of the built-in kinds.", {
        appId: app.id,
        kind: app.kind,
      });
    }
    validateRelativePath(issues, `${prefix}.source`, app.source, { prefix: "shinylive-src/" });
    validateRelativePath(issues, `${prefix}.output`, app.output, { prefix: "apps/" });
    if (!app.path.startsWith(`/apps/${app.id}/`) || !app.path.endsWith("/index.html")) {
      issue(issues, "error", "invalid-app-path", "App path must be /apps/<id>/index.html.", {
        appId: app.id,
        path: app.path,
      });
    }

    validateStringArray(issues, `${prefix}.smokeText`, app.smokeText, { minLength: 1 });
    validateStringArray(issues, `${prefix}.headerProbes`, app.headerProbes, { minLength: 1 });
    validateStringArray(issues, `${prefix}.domProbes`, app.domProbes);
    validateStringArray(issues, `${prefix}.reportTemplates`, app.reportTemplates);
    validateStringArray(issues, `${prefix}.dataPaths`, app.dataPaths);

    for (const reportTemplate of app.reportTemplates) {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(reportTemplate)) {
        issue(issues, "error", "invalid-report-template-id", "report_templates entries must use lowercase letters, numbers, dots, underscores, or hyphens.", {
          appId: app.id,
          reportTemplate,
        });
      }
      const reportTemplatePath = path.join(rootDir, "templates", "reports", reportTemplate, "template.json");
      if (!(await exists(reportTemplatePath))) {
        issue(issues, "error", "missing-report-template", "Configured report template is missing from templates/reports.", {
          appId: app.id,
          reportTemplate,
          path: toPosix(path.relative(rootDir, reportTemplatePath)),
        });
      }
    }

    if (!(await exists(path.join(rootDir, app.source)))) {
      issue(issues, "error", "missing-app-source", "Configured app source directory does not exist.", {
        appId: app.id,
        source: app.source,
      });
    }
    if (!(await exists(path.join(rootDir, app.source, "app.R")))) {
      issue(issues, "error", "missing-app-r", "Configured Shinylive R app is missing app.R.", {
        appId: app.id,
        appR: `${app.source}/app.R`,
      });
    }
    if (app.output && !(await exists(path.join(rootDir, app.output)))) {
      issue(issues, "warning", "missing-app-output", "Configured app output is missing; run harness export.", {
        appId: app.id,
        output: app.output,
      });
    }

    if (app.dataPack) {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(app.dataPack)) {
        issue(issues, "error", "invalid-data-pack-id", "dataPack must use lowercase letters, numbers, dots, underscores, or hyphens.", {
          appId: app.id,
          dataPack: app.dataPack,
        });
      }
      if (app.dataPaths.length === 0) {
        issue(issues, "error", "missing-data-paths", "Apps with dataPack must list dataPaths.", { appId: app.id });
      }
    }

    if (app.dataPackSource) {
      validateRelativePath(issues, `${prefix}.dataPackSource`, app.dataPackSource, { prefix: "data-packs/" });
      if (!(await exists(path.join(rootDir, app.dataPackSource)))) {
        issue(issues, "error", "missing-data-pack-source", "Configured data pack source directory does not exist.", {
          appId: app.id,
          dataPackSource: app.dataPackSource,
        });
      }
    }

    for (const dataPath of app.dataPaths) {
      validateRelativePath(issues, `${prefix}.dataPaths[]`, dataPath);
      if (!(await exists(path.join(rootDir, dataPath)))) {
        issue(issues, "error", "missing-data-path", "Configured data path does not exist.", {
          appId: app.id,
          dataPath,
        });
      }
    }
  }

  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.filter((item) => item.severity === "warning").length;
  const result = {
    schemaVersion: 1,
    ok: errorCount === 0,
    checkedAt: new Date().toISOString(),
    schema: toPosix(path.relative(rootDir, configSchemaPath)),
    project: nextConfig.project,
    summary: {
      appCount: nextConfig.apps.length,
      errorCount,
      warningCount,
    },
    issues,
  };

  if (writeOutputs) {
    await writeJson(reportPath, result);
  }

  return result;
};

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
      logicalPath: logicalDataPackPath(app, relativePath),
      size: metadata.size,
      sha256: await sha256File(targetPath),
    });
  }

  const fingerprint = files
    .map((file) => `${file.logicalPath}\0${file.size}\0${file.sha256}`)
    .sort()
    .join("\n");

  return {
    id: app.dataPack || `${app.id}-data`,
    sourcePath: app.dataPackSource || null,
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
    reportTemplates: app.reportTemplates,
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

  const configValidation = await validateHarnessConfig(nextConfig);
  if (!configValidation.ok) {
    throw new Error("Harness config validation failed. See reports/harness-config-validation.json.");
  }

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
  await writeJson(path.join(distRoot, "reports", "sbom.json"), await createSbom(config, assets));
  await writeFile(path.join(distRoot, "reports", "licenses.md"), await createLicenseReport(config));

  return bundleManifest;
};

const createSbom = async (config, assets) => {
  const npm = await npmPackages();
  const tauriCargo = await cargoPackages(path.join(rootDir, "src-tauri", "Cargo.lock"));
  const serverCargo = await cargoPackages(path.join(rootDir, "crates", "harness-server", "Cargo.lock"));

  return {
    schemaVersion: 2,
    bomFormat: "tauri-shinylive-harness-sbom",
    generatedAt: new Date().toISOString(),
    generatedBy: "tauri-shinylive-harness",
    project: config.project,
    components: [
      ...assets.map((asset) => ({
        type: "file",
        name: asset.path,
        hashes: [{ alg: "SHA-256", content: asset.sha256 }],
        size: asset.size,
      })),
      ...npm.map((pkg) => ({
        type: "library",
        ecosystem: "npm",
        name: pkg.name,
        version: pkg.version,
        licenses: [{ license: { id: pkg.license } }],
      })),
      ...tauriCargo.map((pkg) => ({
        type: "library",
        ecosystem: "cargo",
        scope: "tauri-shell",
        name: pkg.name,
        version: pkg.version,
        licenses: [{ license: { id: pkg.license } }],
      })),
      ...serverCargo.map((pkg) => ({
        type: "library",
        ecosystem: "cargo",
        scope: "harness-server",
        name: pkg.name,
        version: pkg.version,
        licenses: [{ license: { id: pkg.license } }],
      })),
    ],
  };
};

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

const cargoRegistryRoots = async () => {
  const registryRoot = path.join(process.env.CARGO_HOME ?? path.join(homedir(), ".cargo"), "registry", "src");
  if (!(await exists(registryRoot))) {
    return [];
  }
  return (await readdir(registryRoot)).map((entry) => path.join(registryRoot, entry));
};

const cargoLicenseCache = new Map();

const cargoLicenseFor = async (pkg) => {
  const cacheKey = `${pkg.name}@${pkg.version}`;
  if (cargoLicenseCache.has(cacheKey)) {
    return cargoLicenseCache.get(cacheKey);
  }

  for (const registryRoot of await cargoRegistryRoots()) {
    const manifestPath = path.join(registryRoot, `${pkg.name}-${pkg.version}`, "Cargo.toml");
    if (!(await exists(manifestPath))) {
      continue;
    }
    const text = await readFile(manifestPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = stripComment(line).trim();
      if (trimmed.startsWith("license = ")) {
        const license = parseTomlValue(trimmed.replace("license = ", "")) || "unknown";
        cargoLicenseCache.set(cacheKey, license);
        return license;
      }
      if (trimmed.startsWith("license-file = ")) {
        const license = `license-file:${parseTomlValue(trimmed.replace("license-file = ", ""))}`;
        cargoLicenseCache.set(cacheKey, license);
        return license;
      }
    }
  }

  cargoLicenseCache.set(cacheKey, "unknown");
  return "unknown";
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

  const parsedPackages = packages
    .filter((pkg) => pkg.name && pkg.version)
    .sort((a, b) => a.name.localeCompare(b.name));

  return Promise.all(
    parsedPackages.map(async (pkg) => ({
      ...pkg,
      license: await cargoLicenseFor(pkg),
    })),
  );
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
    "This inventory is generated from lockfiles. Cargo package licenses are resolved from the local Cargo registry cache when available; unresolved packages remain `unknown`.",
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
    "2. `node scripts/harness.mjs validate-config`",
    "3. `node scripts/harness.mjs validate-data`",
    "4. `node scripts/harness.mjs export`",
    "5. `node scripts/harness.mjs export-reports`",
    "6. `node scripts/harness.mjs prepare`",
    "7. `npm run test:unit`",
    "8. `node scripts/harness.mjs verify-static`",
    "9. `node scripts/e2e-verify.mjs`",
    "10. `npm run tauri:build`",
    "",
    "## Phase 3 Commands",
    "",
    "1. `npm run phase3:preflight`",
    "2. `npm run tauri:build:app:no-sign` for an unsigned internal release candidate.",
    "3. `npm run tauri:build:app` after Apple signing and notarization credentials are configured.",
    "4. `npm run phase3:package`",
    "5. `npm run phase3:preflight:windows`",
    "6. `npm run tauri:build:windows:no-sign` for an unsigned internal Windows release candidate.",
    "7. `npm run tauri:build:windows` after Windows signing credentials or a signing command are configured.",
    "8. `npm run phase3:package:windows`",
    "9. `npm run local:audit:macos` or `npm run local:audit:windows`",
    "10. `npm run phase3:release-draft` after the release has been reviewed.",
    "",
    "## Acceptance Criteria",
    "",
    "- Portal manifest lists every app from `harness.toml`.",
    "- `reports/harness-config-validation.json` passes with zero errors.",
    "- COOP, COEP, CORP, Service-Worker-Allowed, and MIME headers pass for configured probes.",
    "- The browser reports SharedArrayBuffer availability and cross-origin isolation.",
    "- The portal states the bundled apps are not for clinical decision making.",
    "- Each app exposes its configured smoke text in a same-origin iframe.",
    "- Configured DOM probes are visible, including lab trend and exposure/AE timeline plots.",
    "- Clinical data pack validation passes with zero errors.",
    "- Clinical validation covers treatment-related AE exposure context, lab-linked AE support, medication indication alignment, and exposure interval overlap.",
    "- `reports/clinical-data-pack-validation.json` and `docs/generated/clinical-data-dictionary.md` are generated.",
    "- Configured report templates export HTML report evidence under `reports/exported/`.",
    "- Exported reports include data pack hash, generated timestamp, app version, clinical-use limitation, and reviewer sign-off fields.",
    "- `reports/review-workflow.json` records review status, reviewer, reviewed_at, decision, and notes fields.",
    "- Unit tests cover TOML quoted arrays, location-independent data pack hashes, controlled terminology, and visit-reference validation.",
    "- Playwright screenshot evidence is generated for the portal and verified apps.",
    "- E2E network audit observes no external HTTP(S) requests.",
    "- `dist/harness-bundle-manifest.json` hashes match bundled files.",
    "- Runtime `/__harness/integrity` reports bundled asset hashes as OK.",
    "- Runtime static assets advertise byte range support and cache headers for bundled webR assets.",
    "- `dist/checksums/SHA256SUMS` is generated.",
    "- `dist/reports/sbom.json` and `dist/reports/licenses.md` are generated.",
    "- `reports/phase3-preflight.json` records signing, notarization, GitHub, and tooling readiness.",
    "- `reports/local-release-audit-<platform>.json` records artifact, checksum, disclaimer, signing, and clean-install status.",
    "- `release/` contains platform release artifacts, release notes, checksums, release smoke test plan, and validation pack.",
    "- Windows NSIS installer artifacts are generated on Windows when `windows_bundles` includes `nsis`.",
    "- Public release publication is held until platform signing credentials and organization approval are present.",
    "",
    "## Apps",
    "",
    "| App | Kind | Data Pack | Reports | Smoke Text |",
    "| --- | --- | --- | --- | --- |",
    ...config.apps.map(
      (app) => `| ${app.id} | ${app.kind} | ${app.dataPack || "n/a"} | ${(app.reportTemplates ?? []).join("<br>") || "n/a"} | ${app.smokeText.join("<br>")} |`,
    ),
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
  const executable = commandForPlatform(command);
  const shell = shouldUseShellForPlatform(command);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell,
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
