import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  Server,
  ShieldCheck
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type HarnessApp = {
  id: string;
  title: string;
  path: string;
  description: string;
  kind: string;
  offlineRequired: boolean;
};

type HarnessManifest = {
  schemaVersion: number;
  generatedBy: string;
  apps: HarnessApp[];
};

type HarnessHealth = {
  ok: boolean;
  bindAddress: string;
  port: number;
  assetRoot: string;
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

const HEADER_PROBES = [
  "/portal/index.html",
  "/apps/subject-safety-mini/index.html",
  "/apps/subject-safety-mini/shinylive/webr/R.wasm"
];

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
  const [browserDiagnostics, setBrowserDiagnostics] = useState<BrowserDiagnostics | null>(null);
  const [frameDiagnostics, setFrameDiagnostics] = useState<FrameDiagnostics | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeState, setIframeState] = useState<"loading" | "loaded" | "timeout" | "error">(
    "loading"
  );

  const selectedApp = manifest?.apps[0] ?? null;
  const selectedUrl = selectedApp ? new URL(selectedApp.path, window.location.origin).toString() : "";

  const refreshDiagnostics = useCallback(async () => {
    setLastError(null);

    try {
      const [nextManifest, nextHealth, nextBrowserDiagnostics, nextHeaderProbes] =
        await Promise.all([
          fetchJson<HarnessManifest>("/manifest.json"),
          fetchJson<HarnessHealth>("/__harness/health"),
          getBrowserDiagnostics(),
          Promise.all(
            HEADER_PROBES.map((path) =>
              fetchJson<HeaderProbe>(`/__harness/headers?path=${encodeURIComponent(path)}`)
            )
          )
        ]);

      setManifest(nextManifest);
      setHealth(nextHealth);
      setBrowserDiagnostics(nextBrowserDiagnostics);
      setHeaderProbes(nextHeaderProbes);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data?.type === "shinylive-harness-diagnostics") {
        setFrameDiagnostics(event.data as FrameDiagnostics);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    if (iframeState !== "loading") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setIframeState("timeout"), 30000);
    return () => window.clearTimeout(timeoutId);
  }, [iframeKey, iframeState]);

  const retry = () => {
    setFrameDiagnostics(null);
    setIframeState("loading");
    setIframeKey((value) => value + 1);
    void refreshDiagnostics();
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
  }, [iframeState, frameDiagnostics]);

  const report = useMemo(
    () => ({
      generatedAt: new Date().toISOString(),
      manifest,
      selectedApp,
      selectedUrl,
      browserDiagnostics,
      health,
      headerProbes,
      iframeState,
      iframeDirectDiagnostics,
      frameDiagnostics,
      lastError
    }),
    [
      browserDiagnostics,
      frameDiagnostics,
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
      <aside className="sidebar" aria-label="App status">
        <div className="brand">
          <ShieldCheck size={26} aria-hidden />
          <div>
            <h1>Clinical Shinylive Portal</h1>
            <p>Localhost runtime harness</p>
          </div>
        </div>

        <section className="panel">
          <div className="panel-heading">
            <h2>App</h2>
            <StatusPill ok={iframeState === "loaded"} label={iframeState} />
          </div>
          <h3>{selectedApp?.title ?? "Loading manifest"}</h3>
          <p>{selectedApp?.description ?? "Waiting for /manifest.json"}</p>
          <Field label="Kind" value={selectedApp?.kind} />
          <Field label="Offline required" value={selectedApp?.offlineRequired} />
          <Field label="App URL" value={selectedApp?.path} />
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
              key={iframeKey}
              ref={iframeRef}
              src={selectedApp.path}
              title={selectedApp.title}
              allow="cross-origin-isolated"
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
          <Field label="Root" value={health?.assetRoot} />
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
          <Field label="R smoke" value={frameDiagnostics?.rSmokeResult} />
          <Field label="Shinylive export" value={frameDiagnostics?.shinyliveExportPresent} />
        </section>
      </aside>
    </main>
  );
};
