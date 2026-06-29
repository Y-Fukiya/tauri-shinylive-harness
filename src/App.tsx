import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.mjs";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Server from "lucide-react/dist/esm/icons/server.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type HarnessApp = {
  id: string;
  title: string;
  path: string;
  description: string;
  kind: string;
  offlineRequired: boolean;
  source?: string;
  output?: string;
  smokeText?: string[];
  headerProbes?: string[];
  domProbes?: string[];
  dataPack?: {
    id: string;
    sourcePath?: string | null;
    sha256: string;
    fileCount: number;
    files: Array<{
      path: string;
      size: number;
      sha256: string;
    }>;
  };
};

type HarnessManifest = {
  schemaVersion: number;
  generatedBy: string;
  project?: {
    name: string;
    version: string;
    portalTitle: string;
    portalSubtitle: string;
    bundleName: string;
  };
  distribution?: {
    artifactName: string;
    releaseChannel: string;
    releaseDraft: boolean;
    requireOffline: boolean;
  };
  apps: HarnessApp[];
};

type HarnessHealth = {
  ok: boolean;
  bindAddress: string;
  port: number;
  assetRoot?: string;
  assetRootKind?: string;
  portalPath: string;
  appCount: number;
  securityHeaders: Record<string, string>;
};

type HeaderProbe = {
  ok: boolean;
  path: string;
  normalizedPath: string | null;
  exists: boolean;
  contentType: string | null;
  headers: Record<string, string>;
  error?: string;
};

type BundleIntegrity = {
  ok: boolean;
  checkedAtUnixMs: number;
  manifestPath: string;
  assetCount: number;
  checkedCount: number;
  missing: string[];
  mismatched: Array<{
    path: string;
    expectedSize: number;
    actualSize: number | null;
    expectedSha256: string;
    actualSha256: string | null;
    message: string;
  }>;
  errors: string[];
};

type FrameDiagnostics = {
  type: "shinylive-harness-diagnostics";
  appId: string;
  timestamp: string;
  location: string;
  crossOriginIsolated: boolean;
  sharedArrayBufferAvailable: boolean;
  serviceWorkerAvailable: boolean;
  userAgent: string;
  loadStatus?: string;
  sampleDataLoaded?: boolean;
  subjectCount?: number;
  aeCount?: number;
  seriousAeCount?: number;
  profileSubject?: string;
  labTest?: string;
  dataPackId?: string;
  dataPackSha256?: string;
  dataPackFileCount?: number;
  rSmokeResult?: string;
  shinyliveExportPresent?: boolean;
  note?: string;
  lastError?: string;
};

type BrowserDiagnostics = {
  location: string;
  userAgent: string;
  crossOriginIsolated: boolean;
  sharedArrayBufferAvailable: boolean;
  serviceWorkerAvailable: boolean;
  serviceWorkerRegistrationCount: number | null;
};

const clinicalUseLimitation =
  "This harness and bundled demo applications are for technical evaluation, workflow prototyping, training, and synthetic-data demonstration only. They are not validated medical devices, are not clinical decision support tools, and must not be used for diagnosis, treatment, patient management, or regulatory submission unless separately validated and approved by the responsible organization.";

const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));

const getProbePaths = (app: HarnessApp | null) =>
  unique(["/portal/index.html", app?.path, ...(app?.headerProbes ?? [])].filter(Boolean) as string[]);

const getBrowserDiagnostics = async (): Promise<BrowserDiagnostics> => {
  let serviceWorkerRegistrationCount: number | null = null;

  if ("serviceWorker" in navigator) {
    try {
      serviceWorkerRegistrationCount = (await navigator.serviceWorker.getRegistrations()).length;
    } catch {
      serviceWorkerRegistrationCount = null;
    }
  }

  return {
    location: window.location.href,
    userAgent: navigator.userAgent,
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBufferAvailable: typeof SharedArrayBuffer !== "undefined",
    serviceWorkerAvailable: "serviceWorker" in navigator,
    serviceWorkerRegistrationCount
  };
};

const fetchJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return (await response.json()) as T;
};

const StatusPill = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={ok ? "status-pill status-pill--ok" : "status-pill status-pill--warn"}>
    {ok ? <CheckCircle2 size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}
    {label}
  </span>
);

const Field = ({ label, value }: { label: string; value: unknown }) => (
  <div className="field-row">
    <span>{label}</span>
    <strong>{value === null || value === undefined || value === "" ? "n/a" : String(value)}</strong>
  </div>
);

export const App = () => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [manifest, setManifest] = useState<HarnessManifest | null>(null);
  const [health, setHealth] = useState<HarnessHealth | null>(null);
  const [headerProbes, setHeaderProbes] = useState<HeaderProbe[]>([]);
  const [bundleIntegrity, setBundleIntegrity] = useState<BundleIntegrity | null>(null);
  const [browserDiagnostics, setBrowserDiagnostics] = useState<BrowserDiagnostics | null>(null);
  const [frameDiagnosticsByApp, setFrameDiagnosticsByApp] = useState<Record<string, FrameDiagnostics>>(
    {}
  );
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeState, setIframeState] = useState<"loading" | "loaded" | "timeout" | "error">(
    "loading"
  );

  const apps = manifest?.apps ?? [];
  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? apps[0] ?? null;
  const frameDiagnostics = selectedApp ? frameDiagnosticsByApp[selectedApp.id] ?? null : null;
  const selectedUrl = selectedApp ? new URL(selectedApp.path, window.location.origin).toString() : "";
  const selectedDataPack = selectedApp?.dataPack ?? null;

  const filteredApps = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return apps;
    }
    return apps.filter((app) =>
      [app.id, app.title, app.description, app.kind].some((value) =>
        value.toLowerCase().includes(normalizedQuery)
      )
    );
  }, [apps, query]);

  const refreshDiagnostics = useCallback(
    async (appId = selectedAppId) => {
      setLastError(null);

      try {
        const [nextManifest, nextHealth, nextBundleIntegrity, nextBrowserDiagnostics] = await Promise.all([
          fetchJson<HarnessManifest>("/manifest.json"),
          fetchJson<HarnessHealth>("/__harness/health"),
          fetchJson<BundleIntegrity>("/__harness/integrity"),
          getBrowserDiagnostics()
        ]);
        const nextSelected =
          nextManifest.apps.find((app) => app.id === appId) ?? nextManifest.apps[0] ?? null;
        const nextHeaderProbes = nextSelected
          ? await Promise.all(
              getProbePaths(nextSelected).map((probePath) =>
                fetchJson<HeaderProbe>(
                  `/__harness/headers?path=${encodeURIComponent(probePath)}`
                )
              )
            )
          : [];

        setManifest(nextManifest);
        setHealth(nextHealth);
        setBundleIntegrity(nextBundleIntegrity);
        setBrowserDiagnostics(nextBrowserDiagnostics);
        setHeaderProbes(nextHeaderProbes);
        setSelectedAppId((current) => current ?? nextSelected?.id ?? null);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : String(error));
      }
    },
    [selectedAppId]
  );

  useEffect(() => {
    void refreshDiagnostics();
    // Initial load only; user-initiated selection calls refresh explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data?.type === "shinylive-harness-diagnostics" && event.data.appId) {
        setFrameDiagnosticsByApp((current) => ({
          ...current,
          [event.data.appId]: event.data as FrameDiagnostics
        }));
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    if (iframeState !== "loading") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setIframeState("timeout"), 45000);
    return () => window.clearTimeout(timeoutId);
  }, [iframeKey, iframeState]);

  const selectApp = (appId: string) => {
    setSelectedAppId(appId);
    setIframeState("loading");
    setIframeKey((value) => value + 1);
    void refreshDiagnostics(appId);
  };

  const retry = () => {
    setIframeState("loading");
    setIframeKey((value) => value + 1);
    void refreshDiagnostics(selectedApp?.id ?? null);
  };

  const openSameWindow = () => {
    if (selectedApp) {
      window.location.assign(selectedApp.path);
    }
  };

  const iframeDirectDiagnostics = useMemo(() => {
    if (!iframeRef.current?.contentWindow) {
      return null;
    }

    try {
      const frameWindow = iframeRef.current.contentWindow;
      return {
        crossOriginIsolated: frameWindow.crossOriginIsolated,
        sharedArrayBufferAvailable: "SharedArrayBuffer" in frameWindow
      };
    } catch {
      return null;
    }
  }, [iframeState, frameDiagnostics, selectedAppId]);

  const report = useMemo(
    () => ({
      generatedAt: new Date().toISOString(),
      manifest,
      selectedApp,
      selectedUrl,
      browserDiagnostics,
      bundleIntegrity,
      health,
      headerProbes,
      iframeState,
      iframeDirectDiagnostics,
      frameDiagnosticsByApp,
      lastError
    }),
    [
      browserDiagnostics,
      bundleIntegrity,
      frameDiagnosticsByApp,
      headerProbes,
      health,
      iframeDirectDiagnostics,
      iframeState,
      lastError,
      manifest,
      selectedApp,
      selectedUrl
    ]
  );

  const downloadReport = () => {
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "harness-diagnostics.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="workspace">
      <div className="use-boundary-banner" role="note">
        <strong>Synthetic data only</strong>
        <span>
          Not for diagnosis, treatment decisions, patient management, regulatory submission, GxP
          production, or PHI/PII processing.
        </span>
      </div>
      <aside className="sidebar" aria-label="App status">
        <div className="brand">
          <ShieldCheck size={26} aria-hidden />
          <div>
            <h1>{manifest?.project?.portalTitle ?? "Clinical Shinylive Portal"}</h1>
            <p>{manifest?.project?.portalSubtitle ?? "Localhost runtime harness"}</p>
          </div>
        </div>

        <section className="panel panel--warning safety-notice" aria-label="Clinical use limitation">
          <div className="safety-notice__heading">
            <AlertTriangle size={16} aria-hidden />
            <h2>Clinical Use Limitation</h2>
          </div>
          <p>{clinicalUseLimitation}</p>
        </section>

        <section className="panel clinical-review" aria-label="Clinical review sandbox">
          <div className="panel-heading">
            <h2>Clinical Review</h2>
            <StatusPill ok label="sandbox" />
          </div>
          <Field label="Audience" value="Medical Monitor / Safety Reviewer / Data Manager" />
          <Field label="Scenario" value="Synthetic subject-level safety review" />
          <div className="review-task-list" aria-label="Review tasks">
            <span>Review tasks</span>
            <ol>
              <li>Check exposure-AE timeline</li>
              <li>Review lab abnormality</li>
              <li>Export subject snapshot</li>
            </ol>
          </div>
          <p className="boundary-note">Synthetic data only. Not for clinical decision making.</p>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Apps</h2>
            <StatusPill ok={Boolean(selectedApp)} label={`${apps.length} configured`} />
          </div>
          <label className="search-box">
            <Search size={15} aria-hidden />
            <input
              aria-label="Search apps"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps"
            />
          </label>
          <div className="app-list">
            {filteredApps.map((app) => {
              const active = app.id === selectedApp?.id;
              const diagnostics = frameDiagnosticsByApp[app.id];
              return (
                <button
                  className={active ? "app-option app-option--active" : "app-option"}
                  data-testid={`app-option-${app.id}`}
                  key={app.id}
                  type="button"
                  onClick={() => selectApp(app.id)}
                >
                  <span>
                    <strong>{app.title}</strong>
                    <small>{app.kind}</small>
                  </span>
                  <StatusPill
                    ok={Boolean(diagnostics?.sampleDataLoaded)}
                    label={diagnostics?.loadStatus ?? (active ? iframeState : "idle")}
                  />
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Selected</h2>
            <StatusPill ok={iframeState === "loaded"} label={iframeState} />
          </div>
          <h3>{selectedApp?.title ?? "Loading manifest"}</h3>
          <p>{selectedApp?.description ?? "Waiting for /manifest.json"}</p>
          <Field label="Kind" value={selectedApp?.kind} />
          <Field label="Offline required" value={selectedApp?.offlineRequired} />
          <Field label="App URL" value={selectedApp?.path} />
          <Field label="Data pack" value={selectedDataPack?.id} />
          <Field label="Data source" value={selectedDataPack?.sourcePath} />
          <Field
            label="Data hash"
            value={selectedDataPack?.sha256 ? selectedDataPack.sha256.slice(0, 16) : null}
          />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Actions</h2>
          </div>
          <div className="button-stack">
            <button type="button" onClick={retry}>
              <RefreshCw size={16} aria-hidden />
              Retry
            </button>
            <button type="button" onClick={openSameWindow} disabled={!selectedApp}>
              <ExternalLink size={16} aria-hidden />
              Same-window open
            </button>
            <button type="button" onClick={downloadReport}>
              <Download size={16} aria-hidden />
              Download JSON
            </button>
          </div>
        </section>

        {lastError ? (
          <section className="panel panel--warning">
            <h2>Last loading error</h2>
            <p>{lastError}</p>
          </section>
        ) : null}
      </aside>

      <section className="viewer" aria-label="App viewer">
        <div className="viewer-bar">
          <div>
            <span>Same-origin iframe</span>
            <strong>{selectedUrl || "waiting for manifest"}</strong>
          </div>
          <StatusPill
            ok={Boolean(frameDiagnostics?.sampleDataLoaded)}
            label={frameDiagnostics?.loadStatus ?? iframeState}
          />
        </div>
        <div className="iframe-wrap">
          {selectedApp ? (
            <iframe
              allow="cross-origin-isolated"
              className="harness-app-frame"
              key={`${selectedApp.id}-${iframeKey}`}
              ref={iframeRef}
              src={selectedApp.path}
              title={selectedApp.title}
              onLoad={() => setIframeState("loaded")}
              onError={() => setIframeState("error")}
            />
          ) : (
            <div className="empty-state">Waiting for manifest...</div>
          )}
        </div>
      </section>

      <aside className="diagnostics" aria-label="Diagnostics">
        <div className="diagnostics-title">
          <Server size={20} aria-hidden />
          <h2>Diagnostics</h2>
        </div>

        <section className="panel">
          <h3>Browser</h3>
          <Field label="crossOriginIsolated" value={browserDiagnostics?.crossOriginIsolated} />
          <Field
            label="SharedArrayBuffer"
            value={browserDiagnostics?.sharedArrayBufferAvailable}
          />
          <Field label="ServiceWorker" value={browserDiagnostics?.serviceWorkerAvailable} />
          <Field
            label="SW registrations"
            value={browserDiagnostics?.serviceWorkerRegistrationCount}
          />
        </section>

        <section className="panel">
          <h3>Server</h3>
          <Field label="Health" value={health?.ok} />
          <Field label="Bind" value={health ? `${health.bindAddress}:${health.port}` : null} />
          <Field label="Apps" value={health?.appCount} />
          <Field label="Asset root" value={health?.assetRootKind ?? (health?.assetRoot ? "debug" : "bundled")} />
        </section>

        <section className="panel">
          <h3>Bundle Integrity</h3>
          <Field label="OK" value={bundleIntegrity?.ok} />
          <Field label="Manifest" value={bundleIntegrity?.manifestPath} />
          <Field label="Assets" value={bundleIntegrity?.assetCount} />
          <Field label="Checked" value={bundleIntegrity?.checkedCount} />
          <Field label="Missing" value={bundleIntegrity?.missing.length} />
          <Field label="Mismatched" value={bundleIntegrity?.mismatched.length} />
          <Field label="Errors" value={bundleIntegrity?.errors.length} />
        </section>

        <section className="panel">
          <h3>Headers</h3>
          <div className="probe-list">
            {headerProbes.map((probe) => (
              <div className="probe" key={probe.path}>
                <div>
                  <strong>{probe.path}</strong>
                  <span>{probe.contentType ?? probe.error ?? "missing"}</span>
                </div>
                <StatusPill ok={probe.ok} label={probe.exists ? "ok" : "missing"} />
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>Iframe</h3>
          <Field label="Direct isolated" value={iframeDirectDiagnostics?.crossOriginIsolated} />
          <Field
            label="Direct SAB"
            value={iframeDirectDiagnostics?.sharedArrayBufferAvailable}
          />
          <Field label="Reported isolated" value={frameDiagnostics?.crossOriginIsolated} />
          <Field label="Reported SAB" value={frameDiagnostics?.sharedArrayBufferAvailable} />
          <Field label="Sample data" value={frameDiagnostics?.sampleDataLoaded} />
          <Field label="Subject" value={frameDiagnostics?.profileSubject} />
          <Field label="AE count" value={frameDiagnostics?.aeCount} />
          <Field label="Serious AE" value={frameDiagnostics?.seriousAeCount} />
          <Field label="Lab test" value={frameDiagnostics?.labTest} />
          <Field label="R smoke" value={frameDiagnostics?.rSmokeResult} />
          <Field label="Shinylive export" value={frameDiagnostics?.shinyliveExportPresent} />
        </section>

        <section className="panel">
          <h3>Data Pack</h3>
          <Field label="ID" value={selectedDataPack?.id} />
          <Field label="Source" value={selectedDataPack?.sourcePath} />
          <Field label="Files" value={selectedDataPack?.fileCount} />
          <Field label="SHA-256" value={selectedDataPack?.sha256} />
          <Field label="Runtime SHA-256" value={frameDiagnostics?.dataPackSha256} />
        </section>
      </aside>
    </main>
  );
};
