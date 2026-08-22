const state = { apps: [], tabs: [], appStatuses: [], containers: null, polling: false, primary: false, chromeHidden: false };
const $ = (id) => document.getElementById(id);

function appFor(id) {
  return state.apps.find((app) => app.id === id);
}

function statusFor(id) {
  return state.appStatuses.find((value) => value.id === id) || {
    id,
    state: "stopped",
    error: "",
  };
}

function statusLabel(value) {
  switch (value) {
    case "running": return "运行中";
    case "starting": return "正在启动";
    case "stopping": return "正在停止";
    case "failed": return "启动失败";
    default: return "未启动";
  }
}

async function openFromSidebar(appId, forceNewTab) {
  const existing = forceNewTab ? null : state.tabs.find((tab) => tab.appId === appId);
  try {
    if (existing) {
      await window.openhouse.setAppRunning(appId, true);
      await window.openhouse.activateTab(existing.id);
    } else {
      await window.openhouse.openTab(appId);
    }
  } catch (error) {
    window.alert(error.message || "小 App 启动失败");
  }
}

async function toggleApp(appId) {
  const current = statusFor(appId);
  const shouldRun = current.state !== "running";
  try {
    await window.openhouse.setAppRunning(appId, shouldRun);
  } catch (error) {
    window.alert(error.message || (shouldRun ? "应用启动失败" : "应用停止失败"));
  }
}

function renderSidebar() {
  const root = $("app-list");
  root.textContent = "";
  const active = state.tabs.find((tab) => tab.active);
  for (const app of state.apps) {
    const status = statusFor(app.id);
    const item = document.createElement("div");
    item.className = `app-item${active?.appId === app.id ? " active" : ""}`;

    const launch = document.createElement("button");
    launch.className = "app-launch";
    launch.type = "button";
    launch.title = `打开 ${app.title}；按住 Ctrl 可新建标签页`;
    launch.innerHTML = '<span class="status-dot"></span><span class="app-icon"></span><span class="app-copy"><span class="app-title"></span><span class="app-status"></span></span>';
    launch.querySelector(".app-icon").textContent = app.icon || "W";
    launch.querySelector(".app-title").textContent = app.title;
    launch.querySelector(".app-status").textContent = statusLabel(status.state);
    launch.querySelector(".status-dot").classList.add(status.state);
    launch.addEventListener("click", (event) => {
      void openFromSidebar(app.id, event.ctrlKey || event.metaKey);
    });

    const toggle = document.createElement("button");
    const busy = status.state === "starting" || status.state === "stopping";
    const running = status.state === "running";
    toggle.className = `app-toggle${running ? " on" : ""}`;
    toggle.type = "button";
    toggle.disabled = busy;
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(running));
    toggle.setAttribute("aria-label", `${running ? "停止" : "启动"}${app.title}`);
    toggle.title = busy ? statusLabel(status.state) : `${running ? "停止" : "启动"}${app.title}`;
    toggle.innerHTML = '<span class="toggle-thumb"></span>';
    toggle.addEventListener("click", () => void toggleApp(app.id));

    item.append(launch, toggle);
    if (status.error) {
      const error = document.createElement("div");
      error.className = "app-error";
      error.textContent = status.error;
      error.title = status.error;
      item.appendChild(error);
    }
    root.appendChild(item);
  }
}

function renderDesktop() {
  const root = $("desktop-apps");
  root.textContent = "";
  for (const app of state.apps) {
    const status = statusFor(app.id);
    const button = document.createElement("button");
    button.className = "desktop-app";
    button.type = "button";
    button.innerHTML = '<span class="desktop-app-icon"></span><span class="desktop-app-title"></span><span class="desktop-app-state"></span>';
    button.querySelector(".desktop-app-icon").textContent = app.icon || "W";
    button.querySelector(".desktop-app-title").textContent = app.title;
    button.querySelector(".desktop-app-state").textContent = statusLabel(status.state);
    button.addEventListener("click", (event) => {
      void openFromSidebar(app.id, event.ctrlKey || event.metaKey);
    });
    root.appendChild(button);
  }
}

function renderWorkspaceState() {
  const active = state.tabs.find((tab) => tab.active);
  const panel = $("workspace-state");
  if (!active) {
    panel.hidden = false;
    $("desktop-panel").hidden = false;
    $("service-panel").hidden = true;
    return;
  }
  const app = appFor(active.appId);
  const status = statusFor(active.appId);
  panel.hidden = status.state === "running";
  if (panel.hidden) return;

  $("desktop-panel").hidden = true;
  $("service-panel").hidden = false;

  $("service-icon").textContent = app?.icon || "W";
  $("service-title").textContent = app?.title || active.appId;
  const restart = $("restart-service");
  restart.dataset.appId = active.appId;
  restart.hidden = status.state === "starting" || status.state === "stopping";
  restart.disabled = status.state === "starting" || status.state === "stopping";
  if (status.state === "starting") {
    $("service-message").textContent = "服务正在启动，请稍候。";
  } else if (status.state === "stopping") {
    $("service-message").textContent = "服务正在停止，请稍候。";
  } else if (status.error) {
    $("service-message").textContent = status.error || "服务未能正常运行。";
  } else {
    $("service-message").textContent = "服务已停止，标签页和浏览状态仍然保留。";
  }
}

function renderTabs() {
  const root = $("tabs");
  root.textContent = "";
  for (const tab of state.tabs) {
    const item = document.createElement("div");
    item.className = `tab${tab.active ? " active" : ""}`;
    item.setAttribute("role", "tab");
    item.setAttribute("aria-selected", String(tab.active));
    const title = document.createElement("button");
    title.className = "tab-title";
    title.type = "button";
    title.title = tab.url;
    title.textContent = tab.title || appFor(tab.appId)?.title || tab.appId;
    title.addEventListener("click", () => window.openhouse.activateTab(tab.id));
    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.title = "关闭标签页";
    close.innerHTML = "&times;";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      void window.openhouse.closeTab(tab.id);
    });
    item.append(title, close);
    root.appendChild(item);
  }
  const active = state.tabs.find((tab) => tab.active);
  $("show-desktop").classList.toggle("active", !active);
  $("new-tab").hidden = !active;
  const canOpenInBrowser = Boolean(active && /^https?:\/\//i.test(active.url || ""));
  $("open-browser").hidden = !canOpenInBrowser;
  $("open-browser").disabled = !canOpenInBrowser;
  $("toggle-chrome").hidden = !active;
  $("toggle-chrome").textContent = state.chromeHidden ? "显示边框" : "隐藏边框";
  document.body.classList.toggle("chrome-hidden", state.chromeHidden);
  $("new-window").hidden = !active;
  $("container-count").textContent = state.containers
    ? `${state.containers.active}/${state.containers.max}`
    : "";
  $("container-count").title = state.containers
    ? `网页容器 ${state.containers.active}/${state.containers.max}`
    : "";
  renderSidebar();
  renderDesktop();
  renderWorkspaceState();
}

async function refreshStatuses() {
  if (state.polling) return;
  state.polling = true;
  try {
    state.appStatuses = await window.openhouse.getAppStatuses();
    renderSidebar();
    renderDesktop();
    renderWorkspaceState();
  } catch {
    // Keep the last known state while service-manager is temporarily unavailable.
  } finally {
    state.polling = false;
  }
}

async function init() {
  try {
    state.apps = await window.openhouse.listApps();
  } catch (error) {
    showStartupError(`无法读取应用列表：${error.message || String(error)}`);
    return;
  }
  // Render the desktop as soon as the catalog is available. A temporarily
  // unavailable service-manager must not leave the whole workspace blank.
  state.appStatuses = state.apps.map((app) => ({ id: app.id, state: "stopped", error: "" }));
  renderTabs();
  try {
    const current = await window.openhouse.listTabs();
    state.tabs = current.tabs || [];
    state.containers = current.containers;
    state.primary = Boolean(current.primary);
    state.chromeHidden = Boolean(current.chromeHidden);
    renderTabs();
  } catch (error) {
    showStartupError(`网页工作区初始化失败：${error.message || String(error)}`);
  }
  try {
    state.appStatuses = await window.openhouse.getAppStatuses();
  } catch (error) {
    state.appStatuses = state.apps.map((app) => ({ id: app.id, state: "stopped", error: "服务状态暂时不可用" }));
  }
  renderTabs();
  $("show-desktop").addEventListener("click", () => void window.openhouse.showDesktop());
  $("new-tab").addEventListener("click", async () => {
    const active = state.tabs.find((tab) => tab.active);
    if (!active) return;
    try {
      await window.openhouse.openTab(active.appId);
    } catch (error) {
      window.alert(error.message || "网页容器创建失败");
    }
  });
  $("open-browser").addEventListener("click", async () => {
    const active = state.tabs.find((tab) => tab.active);
    if (!active || !/^https?:\/\//i.test(active.url || "")) return;
    try {
      await window.openhouse.openExternal(active.url);
    } catch (error) {
      window.alert(error.message || "无法打开系统浏览器");
    }
  });
  $("toggle-chrome").addEventListener("click", () => void window.openhouse.toggleChrome());
  $("new-window").addEventListener("click", async () => {
    const active = state.tabs.find((tab) => tab.active);
    if (!active) return;
    try {
      await window.openhouse.openNewWindow();
    } catch (error) {
      window.alert(error.message || "新窗口创建失败");
    }
  });
  $("restart-service").addEventListener("click", (event) => {
    const appId = event.currentTarget.dataset.appId;
    if (appId) void toggleApp(appId);
  });
  window.setInterval(() => void refreshStatuses(), 5000);
}

function showStartupError(message) {
  const panel = $("workspace-state");
  panel.hidden = false;
  $("desktop-panel").hidden = false;
  $("service-panel").hidden = true;
  const root = $("desktop-apps");
  root.textContent = "";
  const error = document.createElement("p");
  error.className = "startup-error";
  error.textContent = message;
  root.appendChild(error);
}

window.openhouse.onTabsState((value) => {
  state.tabs = value.tabs || [];
  state.containers = value.containers;
  state.primary = Boolean(value.primary);
  state.chromeHidden = Boolean(value.chromeHidden);
  renderTabs();
});
window.openhouse.onAppsState((value) => {
  state.appStatuses = value.apps || [];
  renderSidebar();
  renderDesktop();
  renderWorkspaceState();
});
window.openhouse.onTabsError((value) => window.alert(value?.message || "网页容器发生错误"));
window.addEventListener("error", (event) => showStartupError(`工作台加载失败：${event.error?.message || event.message}`));
window.addEventListener("unhandledrejection", (event) => showStartupError(`工作台初始化失败：${event.reason?.message || event.reason || "未知错误"}`));
void init();
