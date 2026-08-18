"use strict";

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const baseAppDefinitions = JSON.parse(
  fs.readFileSync(path.join(__dirname, "apps.json"), "utf8"),
);
let appDefinitions = baseAppDefinitions;

let desktopWindow;
let serviceManagerProcess;
let serviceManagerUrl = "http://127.0.0.1:20087";
let serviceManagerToken = "";
let serviceManagerError = "";
const appWindows = new Map();
const appProcesses = new Map();

function normalizeUrl(value) {
  return String(value).replace(/\/$/, "");
}

function dataRoot() {
  return app.getPath("userData");
}

function stateRoot() {
  return path.join(dataRoot(), "state");
}

function runtimeRoot() {
  return process.env.OPENHOUSE_RUNTIME_ROOT || path.join(process.resourcesPath, "runtime");
}

function runtimeDir(kind) {
  const envName = kind === "repair" ? "OPENHOUSE_REPAIR_RUNTIME_ROOT" : "OPENHOUSE_NORMAL_RUNTIME_ROOT";
  return process.env[envName] || path.join(runtimeRoot(), `wuxianpi-${kind}`);
}

function nodeBinary() {
  if (process.env.OPENHOUSE_NODE_BIN) return process.env.OPENHOUSE_NODE_BIN;
  const name = process.platform === "win32" ? "node.exe" : "node";
  const bundled = path.join(runtimeRoot(), "node", `${process.platform}-${process.arch}`, name);
  return fs.existsSync(bundled) ? bundled : name;
}

function runtimeCommand(kind, port) {
  const root = runtimeDir(kind);
  const runtimeEntry = path.join(root, "runtime", "dist", "index.js");
  const webRoot = path.join(root, "web");
  const agentDir = path.join(stateRoot(), `wuxianpi-${kind}`, "agent");
  return {
    command: [nodeBinary(), runtimeEntry, "--listen", `127.0.0.1:${port}`, "--agent-dir", agentDir, "--web-root", webRoot],
    workingDir: root,
    env: {
      PI_CODING_AGENT_DIR: agentDir,
      OPENHOUSE_WUXIANPI_PROFILE: kind,
      WUXIANPI_WEB_ROOT: webRoot,
      OPENHOUSE_DISABLE_BROWSER_OPEN: "1",
    },
  };
}

function loadBundledWslApps() {
  const manifestPath = path.join(runtimeRoot(), "wsl-apps.json");
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => entry && entry.kind === "managed" && entry.provider === "wsl");
  } catch {
    return [];
  }
}

function managerBinary() {
  if (process.env.OPENHOUSE_SERVICE_MANAGER_BIN) return process.env.OPENHOUSE_SERVICE_MANAGER_BIN;
  const name = process.platform === "win32" ? "service-manager.exe" : "service-manager";
  return path.join(runtimeRoot(), "service-manager", name);
}

function managerConfigPath() {
  return path.join(stateRoot(), "service-manager", "config.json");
}

function managerLogPath() {
  return path.join(stateRoot(), "service-manager", "service-manager.log");
}

function readManagerToken() {
  try {
    const value = JSON.parse(fs.readFileSync(managerConfigPath(), "utf8"));
    return value.auth_token || value.authToken || "";
  } catch {
    return "";
  }
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} 未就绪: ${lastError}`);
}

async function serviceManagerRequest(requestPath, method = "GET", body) {
  if (serviceManagerError) throw new Error(serviceManagerError);
  const headers = { accept: "application/json" };
  if (serviceManagerToken) headers.authorization = `Bearer ${serviceManagerToken}`;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${serviceManagerUrl}${requestPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let value = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = { message: text };
  }
  if (!response.ok) {
    const error = new Error(value?.message || `service-manager HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return value;
}

async function startServiceManager() {
  serviceManagerUrl = normalizeUrl(process.env.OPENHOUSE_SERVICE_MANAGER_URL || serviceManagerUrl);
  serviceManagerToken = process.env.OPENHOUSE_SERVICE_MANAGER_TOKEN || "";

  if (process.env.OPENHOUSE_EXTERNAL_SERVICE_MANAGER === "1") {
    await waitForHttp(`${serviceManagerUrl}/api/v1/health`);
    return;
  }

  const binary = managerBinary();
  if (!fs.existsSync(binary)) {
    serviceManagerError = `找不到内置 service-manager: ${binary}`;
    return;
  }
  await fsp.mkdir(path.dirname(managerConfigPath()), { recursive: true });
  await fsp.mkdir(path.dirname(managerLogPath()), { recursive: true });
  if (!serviceManagerToken) serviceManagerToken = readManagerToken();

  const log = fs.openSync(managerLogPath(), "a");
  serviceManagerProcess = spawn(binary, [
    "serve",
    "--config",
    managerConfigPath(),
    "--bind",
    "127.0.0.1:20087",
  ], {
    detached: false,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  serviceManagerProcess.on("exit", (code) => {
    if (code !== 0 && !serviceManagerError) {
      serviceManagerError = `service-manager 已退出 (${code ?? "unknown"})`;
    }
  });

  await waitForHttp(`${serviceManagerUrl}/api/v1/health`);
  serviceManagerToken = serviceManagerToken || readManagerToken();
}

function serviceSpec(definition) {
  const provider = definition.provider === "wsl"
    ? "wsl"
    : process.platform === "win32" ? "windows-process" : "process";
  const command = provider === "wsl"
    ? {
      command: definition.command || [],
      workingDir: definition.wsl?.cwd || "",
      env: definition.env || {},
    }
    : runtimeCommand(definition.runtime, definition.port);
  if (!command.command.length) throw new Error(`${definition.id} 缺少启动命令`);
  return {
    name: definition.serviceId,
    description: definition.title,
    provider,
    command: command.command,
    working_dir: command.workingDir,
    env: command.env,
    runtime: provider === "wsl" ? definition.wsl || {} : {},
    restart: { mode: "on-failure", max_retries: 3 },
    health: [{ type: "http", url: `${definition.url}health`, interval: "15s", timeout: "3s" }],
    enabled: true,
    residentByDefault: false,
    tags: ["openhouse", definition.id],
  };
}

async function ensureService(definition) {
  try {
    await serviceManagerRequest(`/api/v1/services/${encodeURIComponent(definition.serviceId)}`);
    await serviceManagerRequest(
      `/api/v1/services/${encodeURIComponent(definition.serviceId)}`,
      "PUT",
      serviceSpec(definition),
    );
  } catch (error) {
    if (error.status !== 404) throw error;
    await serviceManagerRequest("/api/v1/services", "POST", serviceSpec(definition));
  }
  await serviceManagerRequest(`/api/v1/services/${encodeURIComponent(definition.serviceId)}/start`, "POST");
  await waitForHttp(definition.url);
}

function appDefinition(id) {
  return appDefinitions.find((definition) => definition.id === id);
}

async function startRepair(definition) {
  const current = appProcesses.get(definition.id);
  if (current && !current.killed) return;
  const command = runtimeCommand("repair", definition.port);
  await fsp.mkdir(command.workingDir, { recursive: true });
  const logDirectory = path.join(stateRoot(), "wuxianpi-repair", "logs");
  await fsp.mkdir(logDirectory, { recursive: true });
  const output = fs.openSync(path.join(logDirectory, "runtime.log"), "a");
  const child = spawn(command.command[0], command.command.slice(1), {
    cwd: command.workingDir,
    env: { ...process.env, ...command.env },
    stdio: ["ignore", output, output],
    windowsHide: true,
  });
  appProcesses.set(definition.id, child);
  child.on("exit", () => appProcesses.delete(definition.id));
  await waitForHttp(definition.url);
}

function stopProcessTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  child.kill();
}

function stopRepair(id) {
  const child = appProcesses.get(id);
  if (!child) return;
  appProcesses.delete(id);
  stopProcessTree(child);
}

async function openApp(id) {
  const definition = appDefinition(id);
  if (!definition) throw new Error(`未知小 App: ${id}`);
  if (definition.kind === "managed") await ensureService(definition);
  if (definition.kind === "repair") await startRepair(definition);

  const existing = appWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return definition.url;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: definition.title,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.on("closed", () => {
    appWindows.delete(id);
    if (definition.kind === "repair") stopRepair(id);
  });
  appWindows.set(id, window);
  await window.loadURL(definition.url);
  return definition.url;
}

function createDesktopWindow() {
  desktopWindow = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    title: "OpenHouse",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  desktopWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("apps:list", () => appDefinitions);
ipcMain.handle("apps:open", (_event, id) => openApp(id));
ipcMain.handle("services:status", async () => serviceManagerRequest("/api/v1/services/statuses"));
ipcMain.handle("runtime:status", () => ({
  serviceManager: serviceManagerError ? "unavailable" : "running",
  serviceManagerError,
}));
ipcMain.handle("shell:open-external", (_event, url) => {
  if (!/^https?:\/\//i.test(url)) throw new Error("只允许打开 HTTP(S) 链接");
  return shell.openExternal(url);
});

app.whenReady().then(async () => {
  await fsp.mkdir(stateRoot(), { recursive: true });
  appDefinitions = [...baseAppDefinitions, ...loadBundledWslApps()];
  try {
    await startServiceManager();
  } catch (error) {
    serviceManagerError = error.message || String(error);
  }
  createDesktopWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createDesktopWindow();
  });
});

let shuttingDown = false;
app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  void (async () => {
    for (const definition of appDefinitions) {
      if (definition.kind !== "managed") continue;
      try {
        await serviceManagerRequest(
          `/api/v1/services/${encodeURIComponent(definition.serviceId)}/stop`,
          "POST",
        );
      } catch {
        // The manager may already be unavailable; process-tree cleanup below
        // still prevents a child runtime from being left behind.
      }
    }
    for (const [id, child] of appProcesses) {
      appProcesses.delete(id);
      stopProcessTree(child);
    }
    stopProcessTree(serviceManagerProcess);
    app.exit(0);
  })();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
