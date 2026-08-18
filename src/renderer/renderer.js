const state = { apps: [], statuses: [], current: "desktop" };
const $ = (id) => document.getElementById(id);

function statusFor(serviceId) {
  const item = state.statuses.find((value) => value.id === serviceId || value.service_id === serviceId);
  return item?.state || item?.status || "unknown";
}

function setView(view) {
  state.current = view;
  $("desktop-view").classList.toggle("hidden", view !== "desktop");
  $("services-view").classList.toggle("hidden", view !== "services");
  $("web-view").classList.toggle("hidden", view !== "web");
  $("title").textContent = view === "desktop" ? "桌面" : view === "services" ? "服务" : "小 App";
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
}

function renderApps() {
  const grid = $("app-grid");
  grid.textContent = "";
  for (const app of state.apps) {
    const card = document.createElement("button");
    card.className = "app-card";
    card.innerHTML = `<span class="app-icon">${app.icon || "W"}</span><span class="app-title"></span><span class="app-status"></span>`;
    card.querySelector(".app-title").textContent = app.title;
    card.querySelector(".app-status").textContent = app.serviceId ? statusFor(app.serviceId) : "网页";
    card.addEventListener("click", () => {
      $("app-frame").src = app.url;
      setView("web");
    });
    grid.appendChild(card);
  }
}

function renderServices() {
  const list = $("service-list");
  list.textContent = "";
  for (const app of state.apps.filter((entry) => entry.serviceId)) {
    const row = document.createElement("article");
    row.className = "service-row";
    row.innerHTML = `<div><strong class="service-name"></strong><span class="service-state"></span></div><div class="service-actions"></div>`;
    row.querySelector(".service-name").textContent = app.title;
    row.querySelector(".service-state").textContent = statusFor(app.serviceId);
    for (const action of ["start", "stop", "restart"]) {
      const button = document.createElement("button");
      button.className = "button button-small";
      button.textContent = action === "start" ? "启动" : action === "stop" ? "停止" : "重启";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await window.openhouse.serviceAction(app.serviceId, action);
          await refreshStatuses();
        } catch (error) {
          window.alert(error.message || "服务操作失败");
        } finally {
          button.disabled = false;
        }
      });
      row.querySelector(".service-actions").appendChild(button);
    }
    list.appendChild(row);
  }
}

async function refreshStatuses() {
  try {
    const result = await window.openhouse.getServiceStatuses();
    state.statuses = Array.isArray(result) ? result : result?.services || [];
  } catch {
    state.statuses = [];
  }
  renderApps();
  renderServices();
}

async function init() {
  state.apps = await window.openhouse.listApps();
  renderApps();
  await refreshStatuses();
  document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $("refresh").addEventListener("click", refreshStatuses);
  $("back").addEventListener("click", () => setView("desktop"));
}

init();
