window.addEventListener("load", () => {
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
      ...details,
    };
    window.parent?.postMessage(payload, window.location.origin);
    if (window.top && window.top !== window.parent) {
      window.top.postMessage(payload, window.location.origin);
    }
  };

  if (window.Shiny) {
    window.Shiny.addCustomMessageHandler("harness-diagnostics", publish);
  }
  publish({ loadStatus: "loaded" });
});
