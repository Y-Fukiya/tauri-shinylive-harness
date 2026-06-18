window.addEventListener("load", () => {
  let resolvedDataPack = {};

  const publish = (extra) => {
    const details = extra || {};
    const payload = {
      type: "shinylive-harness-diagnostics",
      appId: "subject-profile-reference",
      timestamp: new Date().toISOString(),
      location: window.location.href,
      crossOriginIsolated: window.crossOriginIsolated,
      sharedArrayBufferAvailable: typeof SharedArrayBuffer !== "undefined",
      serviceWorkerAvailable: "serviceWorker" in navigator,
      userAgent: navigator.userAgent,
      shinyliveExportPresent: true,
      ...resolvedDataPack,
      ...details,
    };
    window.parent?.postMessage(payload, window.location.origin);
    if (window.top && window.top !== window.parent) {
      window.top.postMessage(payload, window.location.origin);
    }
  };

  const resolveDataPackHash = async () => {
    const marker = document.getElementById("data_pack_hash_value");
    try {
      const response = await fetch("/manifest.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`manifest returned ${response.status}`);
      }
      const manifest = await response.json();
      const app = (manifest.apps || []).find((candidate) => candidate.id === "subject-profile-reference");
      if (!app?.dataPack?.sha256) {
        throw new Error("dataPack hash missing from manifest");
      }
      resolvedDataPack = {
        dataPackId: app.dataPack.id,
        dataPackSha256: app.dataPack.sha256,
        dataPackFileCount: app.dataPack.fileCount,
      };
      if (marker) {
        marker.textContent = app.dataPack.sha256;
        marker.setAttribute("data-harness-status", "resolved");
      }
      publish({ loadStatus: "loaded", sampleDataLoaded: true });
    } catch (error) {
      if (marker) {
        marker.textContent = "manifest unavailable";
        marker.setAttribute("data-harness-status", "unavailable");
      }
      publish({
        loadStatus: "loaded",
        dataPackHashError: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (window.Shiny) {
    window.Shiny.addCustomMessageHandler("harness-diagnostics", publish);
  }
  publish({ loadStatus: "loaded" });
  void resolveDataPackHash();
});
