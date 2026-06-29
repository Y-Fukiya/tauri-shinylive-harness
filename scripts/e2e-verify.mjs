#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

import { distRoot, readConfig, reportsRoot, rootDir } from "./harness-core.mjs";

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
    let settled = false;
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
    const startupTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timed out waiting for harness-server\n${stderr}`));
      }
    }, 30000);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+\/portal\/index\.html/);
      if (match && !settled) {
        settled = true;
        clearTimeout(startupTimeout);
        resolve({ child, portalUrl: match[0] });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(startupTimeout);
        reject(error);
      }
    });
    child.on("exit", (code) => {
      if (!settled && code !== 0) {
        settled = true;
        clearTimeout(startupTimeout);
        reject(new Error(`harness-server exited with ${code}\n${stderr}`));
      }
    });
  });

const stopServer = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
  });

  child.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => {
      setTimeout(resolve, 5000);
    }),
  ]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
  }
};

const writeReport = async (report) => {
  await mkdir(reportsRoot, { recursive: true });
  await writeFile(path.join(reportsRoot, "e2e-diagnostics.json"), `${JSON.stringify(report, null, 2)}\n`);
};

const writeBundleIntegrityReport = async (integrity) => {
  await mkdir(reportsRoot, { recursive: true });
  await writeFile(path.join(reportsRoot, "bundle-integrity.json"), `${JSON.stringify(integrity, null, 2)}\n`);
};

const waitForDomProbe = async (appFrame, domProbe) => {
  const locator = appFrame.locator(domProbe);
  const explicitNavigation = [
    { selector: "#snapshot_report_table", tabs: ["Reports", "Subject Snapshot"] },
    { selector: "#safety_review_table", tabs: ["Reports", "Safety Review"] },
    { selector: "#listing_visits", tabs: ["Reports", "Data Listing"] },
  ].find((candidate) => domProbe.includes(candidate.selector));

  if (explicitNavigation) {
    for (const tabLabel of explicitNavigation.tabs) {
      await appFrame.getByText(tabLabel, { exact: true }).first().click({ timeout: 30000 });
    }
    await locator.waitFor({ state: "visible", timeout: 60000 });
    return;
  }

  try {
    await locator.waitFor({ state: "visible", timeout: 15000 });
    return;
  } catch {
    const tabLabels = ["Overview", "Timeline", "Labs", "AEs", "Meds", "Reports"];
    for (const tabLabel of tabLabels) {
      try {
        await appFrame.getByText(tabLabel, { exact: true }).first().click({ timeout: 5000 });
        await locator.waitFor({ state: "visible", timeout: 15000 });
        return;
      } catch {
        // Try the next tab before surfacing the original probe failure.
      }
    }
    await locator.waitFor({ state: "visible", timeout: 30000 });
  }
};

const appAssetUrl = (portalUrl, app, probe) => {
  const appRoot = app.path.endsWith("/index.html") ? app.path.slice(0, -"/index.html".length) : app.path;
  return new URL(`${appRoot}/${probe}`.replace(/\/{2,}/g, "/"), portalUrl).toString();
};

const verifyRangeCacheProbe = async (requestContext, portalUrl, app) => {
  const probe = (app.headerProbes ?? []).find((candidate) => candidate.endsWith("R.wasm"));
  if (!probe) {
    return {
      appId: app.id,
      ok: true,
      skipped: true,
      reason: "No R.wasm header probe configured.",
    };
  }

  const url = appAssetUrl(portalUrl, app, probe);
  const response = await requestContext.get(url, {
    headers: {
      Range: "bytes=0-15",
    },
  });
  const headers = response.headers();
  const body = await response.body();
  const contentRange = headers["content-range"] ?? "";
  const cacheControl = headers["cache-control"] ?? "";
  const acceptRanges = headers["accept-ranges"] ?? "";
  const contentLength = headers["content-length"] ?? "";
  const ok =
    response.status() === 206 &&
    body.length === 16 &&
    contentRange.startsWith("bytes 0-15/") &&
    acceptRanges.toLowerCase() === "bytes" &&
    cacheControl.includes("immutable") &&
    contentLength === "16";

  return {
    appId: app.id,
    ok,
    skipped: false,
    url,
    status: response.status(),
    bodyLength: body.length,
    headers: {
      acceptRanges,
      cacheControl,
      contentLength,
      contentRange,
      contentType: headers["content-type"] ?? "",
    },
  };
};

const options = parseOptions(process.argv.slice(2));
const appId = options.app ?? options._[0] ?? null;
const config = await readConfig();
const targetApps = appId ? config.apps.filter((app) => app.id === appId) : config.apps;
if (appId && targetApps.length === 0) {
  throw new Error(`No app matched: ${appId}`);
}

const externalRequests = [];
const appResults = [];
const rangeCacheProbes = [];
const screenshots = [];
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
  await page.waitForFunction(() => document.body.innerText.includes("Bundle Integrity"), null, {
    timeout: 20000,
  });
  await page.waitForFunction(() => document.body.innerText.includes("Reported SAB"), null, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () => document.body.innerText.toLowerCase().includes("not for clinical decision making"),
    null,
    {
      timeout: 20000,
    },
  );

  const integrityResponse = await page.request.get(new URL("/__harness/integrity", portalUrl).toString());
  const bundleIntegrity = await integrityResponse.json();
  await writeBundleIntegrityReport(bundleIntegrity);
  const portalClinicalDisclaimer = (await page.locator("body").innerText())
    .toLowerCase()
    .includes("not for clinical decision making");

  await mkdir(path.join(reportsRoot, "screenshots"), { recursive: true });
  const portalScreenshot = path.join(reportsRoot, "screenshots", "portal.png");
  await page.screenshot({ path: portalScreenshot, fullPage: true });
  screenshots.push({ name: "portal", path: path.relative(rootDir, portalScreenshot).split(path.sep).join("/") });

  for (const app of targetApps) {
    rangeCacheProbes.push(await verifyRangeCacheProbe(page.request, portalUrl, app));

    await page.getByTestId(`app-option-${app.id}`).click();
    const appFrame = page.frameLocator("iframe.harness-app-frame").frameLocator("iframe.app-frame");

    for (const smokeText of app.smokeText) {
      await appFrame.getByText(smokeText, { exact: false }).waitFor({ state: "visible", timeout: 60000 });
    }

    for (const domProbe of app.domProbes ?? []) {
      await waitForDomProbe(appFrame, domProbe);
    }

    const screenshotPath = path.join(reportsRoot, "screenshots", `${app.id}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshots.push({ name: app.id, path: path.relative(rootDir, screenshotPath).split(path.sep).join("/") });

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
    ok:
      externalRequests.length === 0 &&
      appResults.every((result) => result.ok) &&
      rangeCacheProbes.every((result) => result.ok) &&
      bundleIntegrity.ok === true &&
      portalClinicalDisclaimer,
    portalUrl,
    checkedAt: new Date().toISOString(),
    appFilter: appId,
    bundleIntegrity,
    portalClinicalDisclaimer,
    appResults,
    rangeCacheProbes,
    externalRequests,
    screenshots,
  };

  await writeReport(report);

  if (!report.ok) {
    throw new Error(`E2E verification failed:\n${JSON.stringify(report, null, 2)}`);
  }
} finally {
  if (browser) {
    await browser.close();
  }
  await stopServer(child);
}
