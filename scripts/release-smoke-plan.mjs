const clinicalUseLimitation =
  "This harness and its bundled synthetic demo apps are for technical evaluation only. They are not validated medical devices and are not for clinical decision making unless an organization completes its own regulated validation and approval.";

const platformInstallSteps = (platform, config, { internalRelease = false } = {}) => {
  if (platform === "windows") {
    const bundles = config.distribution.windowsBundles ?? [];
    const installerStep = bundles.includes("nsis")
      ? "Install the NSIS setup executable on a clean Windows account or VM."
      : "Install the configured Windows installer artifact on a clean Windows account or VM.";
    return [
      "Verify release/SHA256SUMS before installation.",
      installerStep,
      "Launch the installed app from the Start menu.",
      "Record Windows Defender SmartScreen behavior for the release type.",
    ];
  }

  return [
    "Verify release/SHA256SUMS before installation.",
    internalRelease
      ? "Open the dmg or unzip the app bundle on a clean macOS account or VM. Internal unsigned candidates do not include a pkg installer."
      : "Install the pkg or open the dmg on a clean macOS account or VM.",
    "Launch the app from Finder.",
    "Record Gatekeeper behavior for the release type.",
  ];
};

const artifactPatterns = (platform, artifactName, version, config, { internalRelease = false } = {}) => {
  if (platform === "windows") {
    const bundles = config.distribution.windowsBundles ?? [];
    const patterns = [];
    if (bundles.includes("nsis")) {
      patterns.push(`${artifactName}-${version}-windows-nsis-setup.exe`);
    }
    if (bundles.includes("msi")) {
      patterns.push(`${artifactName}-${version}-windows*.msi`);
    }
    return patterns;
  }

  const bundles = config.distribution.macBundles ?? [];
  const patterns = [];
  if (bundles.includes("app")) {
    patterns.push(`${artifactName}-${version}-macos-app.zip`);
  }
  if (bundles.includes("dmg")) {
    patterns.push(`${artifactName}-${version}.dmg`);
  }
  if (bundles.includes("pkg") && !internalRelease) {
    patterns.push(`${artifactName}-${version}.pkg`);
  }
  return patterns;
};

export const buildReleaseSmokePlan = ({ config, context, platform, releaseType, internalRelease = false }) => {
  const apps = config.apps.map((app) => ({
    id: app.id,
    title: app.title,
    path: app.path,
    smokeText: app.smokeText ?? [],
    domProbes: app.domProbes ?? [],
    dataPack: app.dataPack ?? null,
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform,
    project: {
      bundleName: config.project.bundleName,
      version: config.project.version,
    },
    releaseType,
    internalRelease,
    distribution: {
      artifactName: config.distribution.artifactName,
      releaseChannel: config.distribution.releaseChannel,
    },
    context,
    clinicalUseLimitation,
    expectedArtifacts: artifactPatterns(platform, config.distribution.artifactName, config.project.version, config, {
      internalRelease,
    }),
    installSteps: platformInstallSteps(platform, config, { internalRelease }),
    runtimeChecks: [
      "Portal opens on 127.0.0.1.",
      "/__harness/health reports ok: true.",
      "/__harness/integrity reports ok: true.",
      "Portal and release notes display the clinical use limitation.",
      "SharedArrayBuffer and cross-origin isolation diagnostics are true.",
    ],
    offlineChecks: [
      "Quit the app completely.",
      "Disable network access.",
      "Relaunch the app.",
      "Open every configured app.",
      "Confirm configured smoke text and DOM probes render.",
      "Confirm no CDN, GitHub, Posit CDN, r-universe, or other external HTTP(S) requests are observed.",
    ],
    evidenceChecks: [
      "release/SHA256SUMS",
      "release/RELEASE_NOTES.md",
      "release/validation-pack/evidence/static-verification.json",
      "release/validation-pack/evidence/e2e-diagnostics.json",
      "release/validation-pack/evidence/bundle-integrity.json",
      "release/validation-pack/evidence/harness-config-validation.json",
      "release/validation-pack/evidence/clinical-data-pack-validation.json",
      "release/validation-pack/evidence/clinical-data-dictionary.md",
      "release/validation-pack/evidence/screenshots/",
    ],
    apps,
    signOffFields: ["tester", "test_date", "machine", "os_version", "network_state", "decision", "notes"],
  };
};

const checklist = (items) => items.map((item) => `- [ ] ${item}`).join("\n");

export const renderReleaseSmokeMarkdown = (plan) => [
  `# Release Artifact Smoke Test: ${plan.project.bundleName}`,
  "",
  `Version: ${plan.project.version}`,
  `Platform: ${plan.platform}`,
  `Release type: ${plan.releaseType ?? "not available"}`,
  `Release tag: ${plan.context.releaseTag ?? "not available"}`,
  `Git commit: ${plan.context.gitCommit ?? "not available"}`,
  `Git branch/ref: ${plan.context.gitBranch ?? "not available"}`,
  `Generated: ${plan.generatedAt}`,
  "",
  "## Clinical Use Limitation",
  "",
  plan.clinicalUseLimitation,
  "",
  "## Expected Artifacts",
  "",
  checklist(plan.expectedArtifacts.map((artifact) => `Artifact present: \`${artifact}\``)),
  "",
  "## Install And Launch",
  "",
  checklist(plan.installSteps),
  "",
  "## Runtime Integrity",
  "",
  checklist(plan.runtimeChecks),
  "",
  "## Offline Runtime",
  "",
  checklist(plan.offlineChecks),
  "",
  "## App Smoke Matrix",
  "",
  "| App | Smoke text | DOM probes | Data pack |",
  "| --- | --- | --- | --- |",
  ...plan.apps.map(
    (app) =>
      `| ${app.id} | ${(app.smokeText.length ? app.smokeText : ["n/a"]).join("<br>")} | ${(app.domProbes.length ? app.domProbes : ["n/a"]).join("<br>")} | ${app.dataPack ?? "n/a"} |`,
  ),
  "",
  "## Evidence Review",
  "",
  checklist(plan.evidenceChecks.map((item) => `Review \`${item}\``)),
  "",
  "## Tester Sign-Off",
  "",
  "| Field | Value |",
  "| --- | --- |",
  ...plan.signOffFields.map((field) => `| ${field} |  |`),
  "",
].join("\n");
