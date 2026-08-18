const state = { apps: [], statuses: [] };
const $ = (id) => document.getElementById(id);

function statusFor(serviceId) {
  const item = state.statuses.find((value) => value.id === serviceId || value.service_id === serviceId);
  return item?.state || item?.status || "未启动";
}

function renderApps() {
  const grid = $("app-grid");
  grid.textContent = "";
  for (const app of state.apps) {
    const card = document.createElement("button");
    card.className = "app-card";
    const status = app.serviceId ? statusFor(app.serviceId) : "独立运行";
    card.innerHTML = `<span class="app-icon"></span><span class="app-title"></span><span class="app-status"></span>`;
    card.querySelector(".app-icon").textContent = app.icon || "W";
    card.querySelector(".app-title").textContent = app.title;
    card.querySelector(".app-status").textContent = status;
    card.addEventListener("click", async () => {
      card.disabled = true;
      try {
        await window.openhouse.openApp(app.id);
      } catch (error) {
        window.alert(error.message || "小 App 启动失败");
      } finally {
        card.disabled = false;
        await refresh();
      }
    });
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
  renderApps();
}

async function init() {
  state.apps = await window.openhouse.listApps();
  renderApps();
  await refresh();
  $("refresh").addEventListener("click", refresh);
}

void init();
