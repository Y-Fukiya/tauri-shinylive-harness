const statusStyle = "font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #243041;";
const reloadKey = "shinylive-controller-reload";
const root = () => document.getElementById("root");

const renderBootMessage = (message) => {
  const target = root();
  if (!target) return;
  target.textContent = "";
  const wrapper = document.createElement("div");
  wrapper.setAttribute("style", statusStyle);
  wrapper.textContent = message;
  target.appendChild(wrapper);
};

const renderBootError = (error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const target = root();
  if (target) {
    target.textContent = "";
    const pre = document.createElement("pre");
    pre.setAttribute("style", `${statusStyle}; white-space: pre-wrap`);
    pre.textContent = `Shinylive boot failed\n\n${message}`;
    target.appendChild(pre);
  }
  console.error("[shinylive] boot failed", error);
};

const withTimeout = (promise, timeoutMs, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
]);

const waitForServiceWorkerController = async () => {
  if (!("serviceWorker" in navigator)) return;
  await withTimeout(navigator.serviceWorker.ready, 15000, "Timed out waiting for Shinylive ServiceWorker.");
  if (!navigator.serviceWorker.controller) {
    if (sessionStorage.getItem(reloadKey) !== "1") {
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
      await new Promise(() => {});
    }
    throw new Error("ServiceWorker controller was not found after reload.");
  }
  sessionStorage.removeItem(reloadKey);
};

try {
  renderBootMessage("Starting Shinylive...");
  await waitForServiceWorkerController();
  const { runExportedApp } = await import("./shinylive/shinylive.js");
  await runExportedApp({
    id: "root",
    appEngine: "r",
    relPath: "",
  });
} catch (error) {
  renderBootError(error);
}
