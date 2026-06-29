#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { reportsRoot, rootDir, toPosix, writeJson } from "./harness-core.mjs";

const issue = (severity, code, message, details = {}) => ({ severity, code, message, details });

const parseOptions = (values) => {
  const options = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      options._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
};

const check = (id, ok, message, details = {}) => ({ id, ok, message, details });

const forbiddenPermissionPattern = /(?:shell|opener|dialog|clipboard|fs|http|process|notification|os):/i;
const externalUrlPattern = /\bhttps?:\/\/(?!127\.0\.0\.1|localhost)[^\s"')]+/i;

const cspAllowsOnlyLocalHttp = (csp) => {
  const externalHttp = [...String(csp).matchAll(/\bhttps?:\/\/[^;\s]+/g)].map((match) => match[0]);
  return externalHttp.every(
    (url) => url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost") || url.startsWith("http://ipc.localhost"),
  );
};

export const auditTauriSecurity = async ({
  tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json"),
  capabilityPath = path.join(rootDir, "src-tauri", "capabilities", "main.json"),
  tauriLibPath = path.join(rootDir, "src-tauri", "src", "lib.rs"),
  serverLibPath = path.join(rootDir, "crates", "harness-server", "src", "lib.rs"),
  reportPath = path.join(reportsRoot, "tauri-security-audit.json"),
  writeReport = true,
} = {}) => {
  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
  const capability = JSON.parse(await readFile(capabilityPath, "utf8"));
  const tauriLib = await readFile(tauriLibPath, "utf8");
  const serverLib = await readFile(serverLibPath, "utf8");
  const checks = [];
  const issues = [];

  const permissions = capability.permissions ?? [];
  checks.push(
    check(
      "capabilities-minimal",
      permissions.length > 0 && permissions.every((permission) => !forbiddenPermissionPattern.test(permission)),
      "Capabilities avoid shell/open/fs/http/process-style permissions.",
      { permissions },
    ),
  );

  const capabilities = tauriConfig.app?.security?.capabilities ?? [];
  checks.push(
    check(
      "declared-capability-bound",
      capabilities.includes(capability.identifier),
      "tauri.conf.json binds the expected capability identifier.",
      { configuredCapabilities: capabilities, capabilityIdentifier: capability.identifier },
    ),
  );

  const csp = tauriConfig.app?.security?.csp ?? "";
  checks.push(
    check(
      "csp-localhost-only",
      csp.includes("object-src 'none'") && csp.includes("base-uri 'self'") && cspAllowsOnlyLocalHttp(csp),
      "CSP blocks object embedding, fixes base-uri, and allows HTTP only for localhost origins.",
      { csp },
    ),
  );

  const headers = tauriConfig.app?.security?.headers ?? {};
  checks.push(
    check(
      "cross-origin-isolation-headers",
      headers["Cross-Origin-Opener-Policy"] === "same-origin" &&
        headers["Cross-Origin-Embedder-Policy"] === "require-corp" &&
        headers["Cross-Origin-Resource-Policy"] === "same-origin" &&
        headers["X-Content-Type-Options"] === "nosniff",
      "Configured headers preserve cross-origin isolation and MIME sniffing protection.",
      { headers },
    ),
  );

  checks.push(
    check(
      "localhost-navigation-only",
      tauriLib.includes("Url::parse(&server.portal_url)") &&
        tauriLib.includes("window.navigate(portal_url)") &&
        !externalUrlPattern.test(tauriLib),
      "Runtime navigation is derived from the harness localhost server URL.",
      { tauriLibPath: toPosix(path.relative(rootDir, tauriLibPath)) },
    ),
  );

  checks.push(
    check(
      "loopback-bind",
      serverLib.includes("Ipv4Addr::LOCALHOST") && serverLib.includes("TcpListener::bind"),
      "Harness server binds to loopback using an ephemeral port.",
      { serverLibPath: toPosix(path.relative(rootDir, serverLibPath)) },
    ),
  );

  checks.push(
    check(
      "bundled-dist-resource",
      Array.isArray(tauriConfig.bundle?.resources) && tauriConfig.bundle.resources.includes("../dist"),
      "Tauri bundle includes the generated dist directory as a local resource.",
      { resources: tauriConfig.bundle?.resources ?? [] },
    ),
  );

  for (const item of checks) {
    if (!item.ok) {
      issues.push(issue("error", item.id, item.message, item.details));
    }
  }

  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.filter((item) => item.severity === "warning").length;
  const result = {
    schemaVersion: 1,
    ok: errorCount === 0,
    checkedAt: new Date().toISOString(),
    files: {
      tauriConfig: toPosix(path.relative(rootDir, tauriConfigPath)),
      capability: toPosix(path.relative(rootDir, capabilityPath)),
      tauriLib: toPosix(path.relative(rootDir, tauriLibPath)),
      serverLib: toPosix(path.relative(rootDir, serverLibPath)),
    },
    summary: {
      checkCount: checks.length,
      passingCheckCount: checks.filter((item) => item.ok).length,
      errorCount,
      warningCount,
    },
    checks,
    issues,
  };

  if (writeReport) {
    await writeJson(reportPath, result);
  }

  return result;
};

const runCli = async () => {
  const options = parseOptions(process.argv.slice(2));
  const reportPath = options.report ? path.resolve(options.report) : path.join(reportsRoot, "tauri-security-audit.json");
  const result = await auditTauriSecurity({ reportPath });
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        report: toPosix(path.relative(rootDir, reportPath)),
        checks: result.summary.checkCount,
        errors: result.summary.errorCount,
        warnings: result.summary.warningCount,
      },
      null,
      2,
    ),
  );
  if (!result.ok) {
    throw new Error(`Tauri security audit failed. See ${toPosix(path.relative(rootDir, reportPath))}`);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
