const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const apps = JSON.parse(fs.readFileSync(path.join(__dirname, "apps.json"), "utf8"));
const serviceManagerUrl = (process.env.OPENHOUSE_SERVICE_MANAGER_URL || "http://127.0.0.1:20087").replace(/\/$/, "");
const serviceManagerToken = process.env.OPENHOUSE_SERVICE_MANAGER_TOKEN || "";

function serviceManagerRequest(requestPath, method = "GET", body) {
  const headers = { accept: "application/json" };
  if (serviceManagerToken) headers.authorization = `Bearer ${serviceManagerToken}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${serviceManagerUrl}${requestPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (response) => {
    const text = await response.text();
    let value;
    try {
      value = text ? JSON.parse(text) : null;
    } catch {
      value = { message: text };
    }
    if (!response.ok) throw new Error(value?.message || `service-manager HTTP ${response.status}`);
    return value;
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "OpenHouse",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, "renderer", "index.html"));
  return window;
}

ipcMain.handle("apps:list", () => apps.filter((entry) => entry.desktop !== false).sort((a, b) => (a.order || 0) - (b.order || 0)));
ipcMain.handle("services:status", async () => serviceManagerRequest("/api/v1/services/statuses"));
ipcMain.handle("services:action", async (_event, serviceId, action) => {
  const allowed = new Set(["start", "stop", "restart"]);
  if (!allowed.has(action)) throw new Error("unsupported service action");
  const entry = apps.find((item) => item.serviceId === serviceId);
  if (!entry) throw new Error("unknown service");
  return serviceManagerRequest(`/api/v1/services/${encodeURIComponent(serviceId)}/${action}`, "POST");
});
ipcMain.handle("shell:open-external", (_event, url) => shell.openExternal(url));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
