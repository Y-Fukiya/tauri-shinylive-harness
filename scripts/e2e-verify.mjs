#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

import { distRoot, readConfig, reportsRoot, rootDir } from "./harness-core.mjs";

const isLocalRequest = (url) => {
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    return true;
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return true;
  }

  const parsed = new URL(url);
  return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
};

const startServer = async () =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "cargo",
      [
        "run",
        "--quiet",
        "--manifest-path",
        "crates/harness-server/Cargo.toml",
        "--bin",
        "harness-server",
        "--",
        distRoot,
      ],
      { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+\/portal\/index\.html/);
      if (match) {
        resolve({ child, portalUrl: match[0] });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`harness-server exited with ${code}\n${stderr}`));
      }
    });

    setTimeout(() => reject(new Error(`Timed out waiting for harness-server\n${stderr}`)), 30000);
  });

const writeReport = async (report) => {
  await mkdir(reportsRoot, { recursive: true });
  await writeFile(path.join(reportsRoot, "e2e-diagnostics.json"), `${JSON.stringify(report, null, 2)}\n`);
};

const config = await readConfig();
const externalRequests = [];
const appResults = [];
const { child, portalUrl } = await startServer();
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("request", (request) => {
    const url = request.url();
    if (!isLocalRequest(url)) {
      externalRequests.push({ url, method: request.method(), resourceType: request.resourceType() });
    }
  });

  await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Diagnostics"), null, {
    timeout: 20000,
  });
  await page.waitForFunction(() => document.body.innerText.includes("Reported SAB"), null, {
    timeout: 20000,
  });

  for (const app of config.apps) {
    await page.getByTestId(`app-option-${app.id}`).click();
    const appFrame = page.frameLocator("iframe.harness-app-frame").frameLocator("iframe.app-frame");

    for (const smokeText of app.smokeText) {
      await appFrame.getByText(smokeText, { exact: false }).waitFor({ state: "visible", timeout: 60000 });
    }

    for (const domProbe of app.domProbes ?? []) {
      await appFrame.locator(domProbe).waitFor({ state: "visible", timeout: 60000 });
    }

    const portalText = await page.locator("body").innerText();
    appResults.push({
      id: app.id,
      ok: true,
      domProbes: app.domProbes ?? [],
      reportedSharedArrayBuffer: portalText.includes("Reported SAB\ntrue"),
      sampleDataLoaded: portalText.includes("Sample data\ntrue"),
    });
  }

  const report = {
    schemaVersion: 1,
    ok: externalRequests.length === 0 && appResults.every((result) => result.ok),
    portalUrl,
    checkedAt: new Date().toISOString(),
    appResults,
    externalRequests,
  };

  await writeReport(report);

  if (!report.ok) {
    throw new Error(`E2E verification failed:\n${JSON.stringify(report, null, 2)}`);
  }
} finally {
  if (browser) {
    await browser.close();
  }
  child.kill("SIGINT");
}
