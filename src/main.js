"use strict";

const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require("electron");
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
const appShells = new Set();
const appProcesses = new Map();
const DEFAULT_MAX_WEB_CONTAINERS = 6;
const MIN_MAX_WEB_CONTAINERS = 1;
const MAX_MAX_WEB_CONTAINERS = 12;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function normalizeUrl(value) {
  return String(value).replace(/\/$/, "");
}

function dataRoot() {
  return app.getPath("userData");
}

function stateRoot() {
  return path.join(dataRoot(), "state");
}

function settingsPath() {
  return path.join(stateRoot(), "settings.json");
}

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    const max = Number(value.maxWebContainers);
    if (Number.isInteger(max) && max >= MIN_MAX_WEB_CONTAINERS && max <= MAX_MAX_WEB_CONTAINERS) {
      return { maxWebContainers: max };
    }
  } catch {
    // Use defaults when settings are missing or damaged.
  }
  return { maxWebContainers: DEFAULT_MAX_WEB_CONTAINERS };
}

async function writeSettings(settings) {
  await fsp.mkdir(stateRoot(), { recursive: true });
  const temporary = `${settingsPath()}.tmp-${process.pid}`;
  await fsp.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await fsp.rename(temporary, settingsPath());
}

function containerCount() {
  let count = 0;
  for (const window of appShells) count += window.tabs.size;
  return count;
}

function containerStats() {
  const settings = readSettings();
  return {
    active: containerCount(),
    max: settings.maxWebContainers,
    min: MIN_MAX_WEB_CONTAINERS,
    maxAllowed: MAX_MAX_WEB_CONTAINERS,
  };
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

  try {
    await waitForHttp(`${serviceManagerUrl}/api/v1/health`, 1000);
    serviceManagerToken = serviceManagerToken || readManagerToken();
    return;
  } catch {
    // No existing manager is available, start the bundled process below.
  }

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
  if (current && current.exitCode === null && !current.killed) return;
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
  child.on("exit", () => {
    if (appProcesses.get(definition.id) === child) appProcesses.delete(definition.id);
  });
  try {
    await waitForHttp(definition.url);
  } catch (error) {
    stopRepair(definition.id);
    throw error;
  }
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

function sessionKeyFor(definition) {
  if (definition.kind === "repair") return "repair";
  if (definition.kind === "managed") return "normal";
  return definition.id;
}

function configureWebContents(webContents, shellWindow) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  webContents.on("render-process-gone", (_event, details) => {
    if (!shellWindow.destroying && !shellWindow.window.isDestroyed() && details.reason !== "clean-exit") {
      shellWindow.window.webContents.send("tabs:error", {
        message: "网页容器已退出，请关闭此标签页后重试。",
      });
    }
  });
}

function shellForWindow(window) {
  for (const shellWindow of appShells) {
    if (shellWindow.window === window) return shellWindow;
  }
  return undefined;
}

function tabState(shellWindow) {
  return [...shellWindow.tabs.values()].map((tab) => ({
    id: tab.id,
    appId: tab.definition.id,
    title: tab.title || tab.definition.title,
    icon: tab.definition.icon || "W",
    url: tab.url || tab.definition.url,
    active: tab.id === shellWindow.activeTabId,
  }));
}

function sendTabState(shellWindow) {
  if (!shellWindow.window.isDestroyed()) {
    shellWindow.window.webContents.send("tabs:state", {
      tabs: tabState(shellWindow),
      containers: containerStats(),
    });
  }
}

function layoutShell(shellWindow) {
  if (shellWindow.window.isDestroyed()) return;
  const [width, height] = shellWindow.window.getContentSize();
  const topbarHeight = 46;
  for (const tab of shellWindow.tabs.values()) {
    tab.view.setBounds({
      x: 0,
      y: topbarHeight,
      width,
      height: Math.max(0, height - topbarHeight),
    });
    tab.view.setVisible(tab.id === shellWindow.activeTabId);
  }
}

function hasTabForApp(appId) {
  for (const shellWindow of appShells) {
    for (const tab of shellWindow.tabs.values()) {
      if (tab.definition.id === appId) return true;
    }
  }
  return false;
}

function destroyTab(shellWindow, tab) {
  shellWindow.tabs.delete(tab.id);
  shellWindow.window.contentView.removeChildView(tab.view);
  try { tab.view.webContents.close(); } catch { /* already gone */ }
  if (shellWindow.activeTabId === tab.id) {
    shellWindow.activeTabId = shellWindow.tabs.keys().next().value || null;
  }
  if (tab.definition.kind === "repair" && !hasTabForApp(tab.definition.id)) {
    stopRepair(tab.definition.id);
  }
}

async function createTab(shellWindow, appId) {
  const definition = appDefinition(appId);
  if (!definition) throw new Error(`未知小 App: ${appId}`);
  const settings = readSettings();
  if (containerCount() >= settings.maxWebContainers) {
    const error = new Error(`已达到最多同时存在的网页容器数量（${settings.maxWebContainers}）`);
    error.code = "web_container_limit";
    throw error;
  }
  if (definition.kind === "managed") await ensureService(definition);
  if (definition.kind === "repair") await startRepair(definition);

  const tabId = `${definition.id}-${Date.now()}-${shellWindow.sequence++}`;
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `persist:openhouse-${sessionKeyFor(definition)}`,
    },
  });
  const tab = {
    id: tabId,
    definition,
    title: definition.title,
    url: definition.url,
    view,
  };
  configureWebContents(view.webContents, shellWindow);
  view.webContents.on("page-title-updated", (event, title) => {
    event.preventDefault();
    tab.title = title || definition.title;
    sendTabState(shellWindow);
  });
  view.webContents.on("did-navigate", (_event, url) => {
    tab.url = url;
    sendTabState(shellWindow);
  });
  view.webContents.on("did-navigate-in-page", (_event, url) => {
    tab.url = url;
    sendTabState(shellWindow);
  });
  shellWindow.window.contentView.addChildView(view);
  shellWindow.tabs.set(tab.id, tab);
  shellWindow.activeTabId = tab.id;
  try {
    await view.webContents.loadURL(definition.url);
  } catch (error) {
    destroyTab(shellWindow, tab);
    throw error;
  }
  layoutShell(shellWindow);
  sendTabState(shellWindow);
  return tab.id;
}

function closeTab(shellWindow, tabId) {
  const tab = shellWindow.tabs.get(tabId);
  if (!tab) return;
  if (shellWindow.tabs.size === 1) {
    shellWindow.window.close();
    return;
  }
  destroyTab(shellWindow, tab);
  layoutShell(shellWindow);
  sendTabState(shellWindow);
}

function activateTab(shellWindow, tabId) {
  if (!shellWindow.tabs.has(tabId)) return;
  shellWindow.activeTabId = tabId;
  layoutShell(shellWindow);
  sendTabState(shellWindow);
}

async function createAppWindow(definition) {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: definition.title,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const shellWindow = {
    window,
    tabs: new Map(),
    activeTabId: null,
    sequence: 1,
    destroying: false,
  };
  appShells.add(shellWindow);
  window.on("resize", () => layoutShell(shellWindow));
  window.on("closed", () => {
    shellWindow.destroying = true;
    for (const tab of shellWindow.tabs.values()) {
      try { window.contentView.removeChildView(tab.view); } catch { /* window already destroyed */ }
      try { tab.view.webContents.close(); } catch { /* already gone */ }
    }
    shellWindow.tabs.clear();
    appShells.delete(shellWindow);
    if (!hasTabForApp("wuxianpi-repair")) stopRepair("wuxianpi-repair");
  });
  try {
    await window.loadFile(path.join(__dirname, "renderer", "tab-shell.html"));
    await createTab(shellWindow, definition.id);
  } catch (error) {
    window.close();
    throw error;
  }
  return shellWindow;
}

async function openApp(id, options = {}) {
  const definition = appDefinition(id);
  if (!definition) throw new Error(`未知小 App: ${id}`);
  const existingShell = [...appShells].find((shellWindow) =>
    !shellWindow.window.isDestroyed() && [...shellWindow.tabs.values()].some((tab) => tab.definition.id === id));
  if (existingShell && !options.newWindow) {
    const tab = [...existingShell.tabs.values()].find((item) => item.definition.id === id);
    if (tab) activateTab(existingShell, tab.id);
    existingShell.window.focus();
    return definition.url;
  }
  const shellWindow = await createAppWindow(definition);
  shellWindow.window.focus();
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
ipcMain.handle("apps:open", (_event, id, options) => openApp(id, options));
ipcMain.handle("tabs:list", (event) => {
  const shellWindow = shellForWindow(BrowserWindow.fromWebContents(event.sender));
  return shellWindow ? { tabs: tabState(shellWindow), containers: containerStats() } : { tabs: [], containers: containerStats() };
});
ipcMain.handle("tabs:open", async (event, appId) => {
  const shellWindow = shellForWindow(BrowserWindow.fromWebContents(event.sender));
  if (!shellWindow) throw new Error("找不到网页工作窗口");
  return createTab(shellWindow, appId);
});
ipcMain.handle("tabs:close", (event, tabId) => {
  const shellWindow = shellForWindow(BrowserWindow.fromWebContents(event.sender));
  if (shellWindow) closeTab(shellWindow, tabId);
});
ipcMain.handle("tabs:activate", (event, tabId) => {
  const shellWindow = shellForWindow(BrowserWindow.fromWebContents(event.sender));
  if (shellWindow) activateTab(shellWindow, tabId);
});
ipcMain.handle("tabs:new-window", async (event, appId) => {
  const definition = appDefinition(appId);
  if (!definition) throw new Error(`未知小 App: ${appId}`);
  return openApp(appId, { newWindow: true });
});
ipcMain.handle("containers:settings", () => containerStats());
ipcMain.handle("containers:set-max", async (_event, value) => {
  const max = Number(value);
  if (!Number.isInteger(max) || max < MIN_MAX_WEB_CONTAINERS || max > MAX_MAX_WEB_CONTAINERS) {
    throw new Error(`网页容器上限必须是 ${MIN_MAX_WEB_CONTAINERS} 到 ${MAX_MAX_WEB_CONTAINERS} 之间的整数`);
  }
  await writeSettings({ maxWebContainers: max });
  for (const shellWindow of appShells) sendTabState(shellWindow);
  return containerStats();
});
ipcMain.handle("app-window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});
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

app.on("second-instance", () => {
  if (desktopWindow && !desktopWindow.isDestroyed()) {
    if (desktopWindow.isMinimized()) desktopWindow.restore();
    desktopWindow.focus();
  }
});

let shuttingDown = false;
app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  void (async () => {
    for (const shellWindow of appShells) {
      shellWindow.destroying = true;
      for (const tab of shellWindow.tabs.values()) {
        shellWindow.window.contentView.removeChildView(tab.view);
        try { tab.view.webContents.close(); } catch { /* already gone */ }
      }
      shellWindow.tabs.clear();
    }
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
