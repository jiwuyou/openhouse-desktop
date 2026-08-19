const state = { apps: [], tabs: [], containers: null };
const $ = (id) => document.getElementById(id);

function appFor(id) {
  return state.apps.find((app) => app.id === id);
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
  $("new-window").disabled = !active;
  $("container-count").textContent = state.containers
    ? `${state.containers.active}/${state.containers.max}`
    : "";
  $("container-count").title = state.containers
    ? `网页容器 ${state.containers.active}/${state.containers.max}`
    : "";
}

function renderAppPicker() {
  const picker = $("app-picker");
  picker.textContent = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = "新建网页容器";
  picker.appendChild(first);
  for (const app of state.apps) {
    const option = document.createElement("option");
    option.value = app.id;
    option.textContent = app.title;
    picker.appendChild(option);
  }
}

async function openSelectedApp() {
  const appId = $("app-picker").value;
  if (!appId) return;
  try {
    await window.openhouse.openTab(appId);
  } catch (error) {
    window.alert(error.message || "网页容器创建失败");
  } finally {
    $("app-picker").value = "";
  }
}

async function init() {
  state.apps = await window.openhouse.listApps();
  renderAppPicker();
  const current = await window.openhouse.listTabs();
  state.tabs = current.tabs || [];
  state.containers = current.containers;
  renderTabs();
  $("new-tab").addEventListener("click", async () => {
    const active = state.tabs.find((tab) => tab.active);
    if (!active) return;
    try {
      await window.openhouse.openTab(active.appId);
    } catch (error) {
      window.alert(error.message || "网页容器创建失败");
    }
  });
  $("app-picker").addEventListener("change", () => void openSelectedApp());
  $("new-window").addEventListener("click", async () => {
    const active = state.tabs.find((tab) => tab.active);
    if (!active) return;
    try {
      await window.openhouse.openNewWindow(active.appId);
    } catch (error) {
      window.alert(error.message || "新窗口创建失败");
    }
  });
  $("close-window").addEventListener("click", () => void window.openhouse.closeAppWindow());
}

window.openhouse.onTabsState((value) => {
  state.tabs = value.tabs || [];
  state.containers = value.containers;
  renderTabs();
});
window.openhouse.onTabsError((value) => window.alert(value?.message || "网页容器发生错误"));
void init();
