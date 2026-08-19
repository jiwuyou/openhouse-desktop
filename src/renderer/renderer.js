const state = { apps: [], statuses: [], containers: null };
const $ = (id) => document.getElementById(id);

function statusFor(serviceId) {
  const item = state.statuses.find((value) => value.id === serviceId || value.service_id === serviceId);
  return item?.state || item?.status || "未启动";
}

function renderApps() {
  const grid = $("app-grid");
  grid.textContent = "";
  for (const app of state.apps) {
    const card = document.createElement("article");
    card.className = "app-card";
    const status = app.serviceId ? statusFor(app.serviceId) : "独立运行";
    card.innerHTML = `<button class="app-open" type="button"><span class="app-icon"></span><span class="app-title"></span><span class="app-status"></span></button><button class="app-new-window" type="button">新窗口</button>`;
    card.querySelector(".app-icon").textContent = app.icon || "W";
    card.querySelector(".app-title").textContent = app.title;
    card.querySelector(".app-status").textContent = status;
    const open = card.querySelector(".app-open");
    const newWindow = card.querySelector(".app-new-window");
    const launch = async (options) => {
      open.disabled = true;
      newWindow.disabled = true;
      try {
        await window.openhouse.openApp(app.id, options);
      } catch (error) {
        window.alert(error.message || "小 App 启动失败");
      } finally {
        open.disabled = false;
        newWindow.disabled = false;
        await refresh();
      }
    };
    open.addEventListener("click", (event) => void launch({ newWindow: event.ctrlKey || event.metaKey }));
    newWindow.addEventListener("click", () => void launch({ newWindow: true }));
    grid.appendChild(card);
  }
}

async function refresh() {
  const runtime = await window.openhouse.getRuntimeStatus();
  $("runtime-status").textContent = runtime.serviceManager === "running"
    ? "本地服务已就绪"
    : runtime.serviceManagerError || "本地服务不可用，维修入口仍可用";
  try {
    const result = await window.openhouse.getServiceStatuses();
    state.statuses = Array.isArray(result) ? result : result?.services || [];
  } catch {
    state.statuses = [];
  }
  state.containers = await window.openhouse.getContainerSettings();
  const maxInput = $("max-containers");
  maxInput.value = state.containers.max;
  maxInput.title = `当前已使用 ${state.containers.active} 个网页容器，最多 ${state.containers.max} 个`;
  renderApps();
}

async function init() {
  state.apps = await window.openhouse.listApps();
  renderApps();
  await refresh();
  $("refresh").addEventListener("click", refresh);
  $("max-containers").addEventListener("change", async (event) => {
    try {
      state.containers = await window.openhouse.setMaxWebContainers(event.target.value);
      event.target.value = state.containers.max;
      event.target.title = `当前已使用 ${state.containers.active} 个网页容器，最多 ${state.containers.max} 个`;
    } catch (error) {
      window.alert(error.message || "网页容器上限设置失败");
      event.target.value = state.containers?.max || 6;
    }
  });
}

void init();
