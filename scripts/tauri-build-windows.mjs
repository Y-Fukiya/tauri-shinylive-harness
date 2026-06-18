#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readConfig, rootDir, runCommand } from "./harness-core.mjs";

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

const options = parseOptions(process.argv.slice(2));
const config = await readConfig();
const bundles = String(options.bundles ?? config.distribution.windowsBundles.join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (bundles.length === 0) {
  throw new Error("No Windows bundles configured. Use distribution.windows_bundles or --bundles.");
}

const tauriArgs = ["tauri", "build", "--bundles", bundles.join(",")];
if (options["no-sign"]) {
  tauriArgs.push("--no-sign");
} else {
  const windowsConfig = {};
  if (process.env.WINDOWS_CERTIFICATE_THUMBPRINT) {
    windowsConfig.certificateThumbprint = process.env.WINDOWS_CERTIFICATE_THUMBPRINT;
    windowsConfig.digestAlgorithm = process.env.WINDOWS_DIGEST_ALGORITHM ?? "sha256";
    windowsConfig.timestampUrl = process.env.WINDOWS_TIMESTAMP_URL ?? "http://timestamp.digicert.com";
  }
  if (process.env.WINDOWS_SIGN_COMMAND) {
    windowsConfig.signCommand = process.env.WINDOWS_SIGN_COMMAND;
  }
  if (Object.keys(windowsConfig).length === 0) {
    throw new Error(
      "Windows signing is not configured. Set WINDOWS_CERTIFICATE_THUMBPRINT or WINDOWS_SIGN_COMMAND, or run with --no-sign.",
    );
  }

  const overridePath = path.join(os.tmpdir(), `tauri-windows-signing-${process.pid}.json`);
  await mkdir(path.dirname(overridePath), { recursive: true });
  await writeFile(
    overridePath,
    `${JSON.stringify(
      {
        bundle: {
          windows: windowsConfig,
        },
      },
      null,
      2,
    )}\n`,
  );
  tauriArgs.push("--config", overridePath);
}

await runCommand("npx", tauriArgs, { cwd: rootDir });
